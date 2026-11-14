/* eslint-disable */
// Clay Robot — Originkit. Repris tel quel du portfolio (components/ui/clay-robot.tsx) : c'est le visage de l'assistant IA de Niala.

"use client"

import { useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"

/* ------------------------------------------------------------------ *
 *  ClayRobot
 *
 *  Built after a still the user supplied: a small matte clay robot in a
 *  studio render, standing on a blue-grey cyclorama with a long cool
 *  shadow raked out to the left by a low sun. The light, the clay, the
 *  body and the floor follow that still; the helmet has since been made
 *  round and the robot recoloured so it is its own character, and the
 *  still's toy scenery is gone. Our component is called ClayRobot.
 *
 *  THE FORM IS ONE SIGNED DISTANCE FIELD
 *    Helmet   a slightly wide ellipse from the front, extruded and rolled
 *             almost to its full depth so it reads as a soft pillow.
 *    Visor    a round bed carved with a smooth subtraction, which rolls
 *             the rim into the groove, and a domed round screen sitting
 *             a hair inside it so the gap reads as a dark crease.
 *    Eyes     not geometry: a 2-D signed distance drawn on the screen in
 *             head space, anti-aliased over the pixel, so blinking, looking
 *             and the happy "^ ^" are all one shape morphing.
 *    Body     rounded box + arch between the feet + two ellipsoid arms
 *             hinged at the shoulder, all smooth-unioned. A step lifts
 *             the lower body on one side; a wave stretches one arm.
 *  Units are the still's pixels / 100 at the robot's depth, origin
 *  between the feet.
 *
 *  LIGHT
 *    A blue-grey sky dome (stronger from above and from the sun side) and
 *    one low warm sun from the right, with a soft shadow traced through
 *    the field, fitted per pixel against the still. The floor is not lit;
 *    its shadow is a mix from the Background toward the Shadow colour.
 *
 *  WHAT IT DOES
 *    Head, eyes and body follow the cursor (page-wide or within the
 *    frame) on critically damped springs; eyes lead, body lags. It walks
 *    along the floor to stand under the cursor -- a waddle whose steps
 *    advance with distance, so the feet never slide -- and home again
 *    once the cursor has gone. It waves hello when it lands and when the
 *    cursor arrives, stopping to face you first. When no one is pointing
 *    it glances about and blinks. A tap makes it hop. It can drop in.
 *
 *  PORTFOLIO ADDITION
 *    `transparent` drops the cyclorama: pixels that miss the robot are
 *    clear, and the floor shadow is drawn as a translucent tint, so the
 *    robot can stand straight on the page behind it. Output is then
 *    premultiplied alpha. Everything else is the original component.
 *
 *  COST
 *    Rays are clipped to the head's and body's boxes before marching;
 *    floor pixels trace a shadow ray only when it can meet the robot;
 *    parts are skipped inside the field by their boxes. Only edge pixels
 *    are supersampled. Frames are drawn only while something moves,
 *    vsync-locked, and the buffer steps down when the GPU runs late.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------ defaults */

const REF_W = 1200
const REF_H = 900
const REF_ASPECT = REF_W / REF_H

const DEFAULT_BACKGROUND = {
    top: "#909EA9",
    bottom: "#CCD0D3",
    shadow: "#2E4D6A",
    shadowDepth: 100,
}

const DEFAULT_COLORS = {
    clay: "#FFC2A1",
    visor: "#2E3747",
    eyes: "#C4F7EC",
}

const DEFAULT_PLACEMENT = { x: 0, y: 0, angle: 0, tilt: 0 }

const DEFAULT_RESPONSE = {
    track: "page" as "page" | "frame",
    headTurn: 7,
    eyeTravel: 6,
    followSpeed: 6,
    hop: 6,
}

const DEFAULT_ADVANCED = {
    cameraDistance: 30,
    sunAngle: 90,
    sunElevation: 25,
    sunStrength: 1,
    skyStrength: 1,
    shadowSoftness: 6,
    occlusion: 1,
    eyeGlow: 0.6,
    gradientCurve: 1.3,
}

const DEFAULTS = {
    walk: true,
    walkSpeed: 5,
    wave: true,
    scale: 100,
    animate: false,
    delay: 0.2,
    glance: 5,
    blink: true,
}

/* -------------------------------------------------------- fixed values */

// Camera height above the floor: the still's frame centre (y 450) sits
// 3.33 units above the feet (y 783).
const CAM_Y = 3.33
// Reference frame height in world units at the robot's depth.
const FRAME_UNITS = REF_H / 100
// Roll turns the composition about its own middle, not the camera axis:
// the robot spans 0..5.9 units, the axis sits at 3.33.
const ROLL_CY = 2.95 - CAM_Y
// Head centre and the point it turns about (just above the neck).
const HEAD_Y = 4.08
const PIVOT_Y = 2.55
// The look target is the cursor's ray met at this depth -- between the
// robot (z 0) and the lens -- so the head turns toward the point on the
// glass the cursor is on, at any Placement or Scale.
const LOOK_Z = 7
// The body turns this share of the head's yaw; the head rolls this much
// per radian of yaw, which is the "curious tilt".
const BODY_SHARE = 0.28
const HEAD_ROLL = -0.16
// Eye travel on the screen, head-space units.
const EYE_X = 0.62
const EYE_UP = 0.46
const EYE_DOWN = 0.2
// Timings.
const BLINK_S = 0.17
const HOP_CROUCH = 0.09
const HOP_AIR = 0.46
const LAND_S = 0.55
const JOY_S = 0.95
const DROP_S = 0.62
const DROP_FROM = 9.5
// Walking: scene units per step, foot lift, side-to-side roll, bob, arm
// swing, and how far the body turns toward where it is going.
const STRIDE = 0.62
const STEP_LIFT = 0.17
const WADDLE = 0.075
const BOB = 0.05
const ARM_SWING = 0.5
const WALK_TURN = 0.5
// Keeps the whole robot (helmet and ears) inside the frame while walking.
const WALK_MARGIN = 3.05
// Begin a walk only for a gap worth crossing; settle once this close.
const WALK_START = 0.6
// Waving: raise, wave, lower (s); the arm's hanging and raised angles,
// and the waves themselves.
const ARM_REST = 0.28
const WAVE_UP = 0.35
const WAVE_HOLD = 1.5
const WAVE_DOWN = 0.4
const WAVE_RAISE = 2.0
const WAVE_SWAY = 0.3
const WAVE_HZ = 2.3

// Light, linear, fitted per pixel against the still (least squares over
// the robot's surface with this file's own normals, occlusion and
// shadow as the basis). The clay's albedo is folded in, so the Clay
// colour acts as a tint relative to its default.
const SKY = [0.456, 0.52, 0.541]
const SKY_UP = [0.03, 0.019, 0.011]
const SKY_SIDE = [0.01, 0.052, 0.081]
const SKY_AWAY = [-0.151, -0.124, -0.087]
const SUN = [0.293, 0.227, 0.17]

// Pixel budget and the buffer steps the quality ladder can take.
const DPR_CAP = 2
const PIXEL_BUDGET = 2.6e6
const LEVELS = [1, 0.85, 0.72, 0.6]

/* --------------------------------------------------------------- types */

export interface ClayRobotBackground {
    /** Top of the cyclorama gradient. */
    top?: string
    /** Bottom of the cyclorama gradient (the floor). */
    bottom?: string
    /** Colour of the floor at the heart of the robot's shadow. */
    shadow?: string
    /** How dark the shadows are, % (0 = none, 100 = the reference). */
    shadowDepth?: number
}

export interface ClayRobotColors {
    /** Helmet, ears and body. */
    clay?: string
    /** The screen inside the visor. */
    visor?: string
    /** The two eyes shown on the screen. */
    eyes?: string
}

export interface ClayRobotPlacement {
    x?: number
    y?: number
    angle?: number
    tilt?: number
}

export interface ClayRobotResponse {
    /** Follow the cursor anywhere on the page, or only over the frame. */
    track?: "page" | "frame"
    /** How far the head turns toward the cursor (0 keeps it still). */
    headTurn?: number
    /** How far the eyes slide across the screen. */
    eyeTravel?: number
    /** How quickly it catches up with the cursor. */
    followSpeed?: number
    /** Height of the hop on tap (0 turns tapping off). */
    hop?: number
}

export interface ClayRobotAdvanced {
    cameraDistance?: number
    sunAngle?: number
    sunElevation?: number
    sunStrength?: number
    skyStrength?: number
    shadowSoftness?: number
    occlusion?: number
    eyeGlow?: number
    gradientCurve?: number
}

export interface ClayRobotProps {
    background?: ClayRobotBackground
    colors?: ClayRobotColors
    /** How big the robot draws in its frame, 100% = the reference. */
    scale?: number
    placement?: ClayRobotPlacement
    /** Drop in from above when it first appears. */
    animate?: boolean
    /** Seconds before the drop-in starts. */
    delay?: number
    response?: ClayRobotResponse
    /** How often it glances about when no one is pointing (0 = never). */
    glance?: number
    /** Walk along the floor to stand under the cursor. */
    walk?: boolean
    /** How fast it walks. */
    walkSpeed?: number
    /** Wave hello when it lands and when the cursor arrives. */
    wave?: boolean
    /** Blink now and then. */
    blink?: boolean
    advanced?: ClayRobotAdvanced
    /** No backdrop: the robot and its shadow are drawn over whatever is behind. Read once, on mount. */
    transparent?: boolean
    style?: CSSProperties
}

/* ------------------------------------------------------------- colours */

const colorCache = new Map<string, [number, number, number]>()

/** sRGB 0..1 from hex / rgb() / rgba() / var(--x, fallback). */
function toRGB(input: string | undefined, fallback: string): [number, number, number] {
    const key = input || fallback
    const hit = colorCache.get(key)
    if (hit) return hit
    let s = key.trim()
    const v = /^var\([^,]+,\s*(.+)\)$/.exec(s)
    if (v) s = v[1].trim()
    let out: [number, number, number] | null = null
    const hex = /^#([0-9a-f]{3,8})$/i.exec(s)
    if (hex) {
        let h = hex[1]
        if (h.length === 3 || h.length === 4)
            h = h
                .slice(0, 3)
                .split("")
                .map((c) => c + c)
                .join("")
        out = [
            parseInt(h.slice(0, 2), 16) / 255,
            parseInt(h.slice(2, 4), 16) / 255,
            parseInt(h.slice(4, 6), 16) / 255,
        ]
    } else {
        const m = /rgba?\(([^)]+)\)/i.exec(s)
        if (m) {
            const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat)
            if (p.length >= 3) out = [p[0] / 255, p[1] / 255, p[2] / 255]
        }
    }
    if (!out) out = key === fallback ? [0.5, 0.5, 0.5] : toRGB(fallback, fallback)
    colorCache.set(key, out)
    return out
}

const lin = (c: number) => Math.pow(c, 2.2)
// The clay the light was fitted under; colours apply relative to it.
const CLAY_LIN = [0xee, 0xef, 0xeb].map((c) => lin(c / 255))

/* ------------------------------------------------------------- shaders */

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const FRAG = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uRes;      // buffer px
uniform float uS;       // reference frame height, buffer px
uniform vec2 uOff;      // placement offset, buffer px (GL y-up)
uniform vec2 uRoll;     // cos, sin of Angle
uniform float uD;       // camera distance
uniform mat3 uW2S;      // world -> scene (tilt, scale)
uniform float uScale;   // scene -> world distance
uniform float uHop;     // robot lift, scene units
uniform vec2 uSq;       // squash: x/z scale, y scale
uniform mat3 uBody;     // world-from-body inverse (yaw)
uniform mat3 uHead;     // body-from-head inverse (yaw, pitch, roll)
uniform vec4 uEye;      // eye offset x, y, open 0..1, joy 0..1
uniform vec3 uBoxMin;   // scene-space bounds of everything drawn
uniform vec3 uBoxMax;
uniform vec3 uSun;      // world direction toward the sun
uniform vec3 uSunCol;   // linear
uniform vec3 uSky;      // linear, flat fill
uniform vec3 uSkyUp;    // linear, per unit of n.y
uniform vec3 uSkySide;  // linear, per unit facing the sun
uniform vec3 uSkyAway;  // linear, per unit facing away from it
uniform float uSoft;
uniform float uAO;
uniform vec3 uBgTop;    // sRGB
uniform vec3 uBgBot;
uniform float uCurve;
uniform vec3 uShadowCol;
uniform float uShDepth; // 0 no shadow .. 1 full shadow
uniform vec3 uClay;     // linear albedo
uniform vec3 uVisor;
uniform vec3 uEyeCol;   // sRGB, emissive
uniform float uGlow;
uniform float uWalkX;   // robot's walk along the floor, scene units
uniform vec2 uFeet;     // lift of the left and right foot
uniform vec4 uArms;     // left (raise, swing), right (raise, swing)
uniform vec2 uArmExt;   // how far each arm is stretched out, 0..1
uniform vec4 uBodyBox;  // body box: centre y, half size xyz
uniform int uSamples;
uniform float uClear;   // 1 = transparent backdrop, premultiplied output

out vec4 fragColor;

#define CAM_Y ${CAM_Y.toFixed(3)}
#define FRAME_UNITS ${FRAME_UNITS.toFixed(3)}
#define ROLL_CY ${ROLL_CY.toFixed(3)}
#define HEAD_C vec3(0.0, ${HEAD_Y.toFixed(3)}, 0.0)
#define PIVOT vec3(0.0, ${PIVOT_Y.toFixed(3)}, 0.0)

float smin(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * 0.25;
}
float smax(float a, float b, float k) { return -smin(-a, -b, k); }

float sdRR(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
// Rounded rectangle (half size b, corner rc) extruded to half depth hz,
// every depth edge rounded by re.
float sdSlab(vec3 p, vec2 b, float rc, float hz, float re) {
    float d = sdRR(p.xy, b, rc);
    vec2 w = vec2(d + re, abs(p.z) - hz + re);
    return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - re;
}
float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
float sdRBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float sdEll(vec3 p, vec3 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / k1;
}
float sdCap(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}
// Arc about +y, half-aperture given as (sin, cos), radius ra, thickness rb.
float sdArc(vec2 p, vec2 sc, float ra, float rb) {
    p.x = abs(p.x);
    return ((sc.y * p.x > sc.x * p.y) ? length(p - sc * ra) : abs(length(p) - ra)) - rb;
}

// 2-D ellipse distance (iq's bound: exact on the outline, safe off it).
float sdEll2(vec2 p, vec2 r) {
    float k0 = length(p / r);
    float k1 = max(length(p / (r * r)), 1e-4);
    return k0 * (k0 - 1.0) / k1;
}
// An outline (2-D distance d2) extruded to half depth hz, every depth
// edge rounded by re.
float extrude(float d2, float z, float hz, float re) {
    vec2 w = vec2(d2 + re, abs(z) - hz + re);
    return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - re;
}

/* head space: origin at the helmet's centre, +z toward the lens.
   The helmet is round -- a slightly wide ellipse from the front, rolled
   into a deep pillow -- with a round domed screen set in it. Coarse
   leaves out the screen: shadow and sky probes only need the shell, and
   the screen sits inside the shell's open bed. */
vec2 head(vec3 p, bool fine) {
    float sh = extrude(sdEll2(p.xy, vec2(2.5, 2.3)), p.z, 0.95, 0.8);
    // A soft-walled round bed for the screen: the rim rolls into it.
    vec2 v = p.xy - vec2(0.0, -0.1);
    sh = smax(sh, -extrude(sdEll2(v, vec2(2.02, 1.8)), p.z - 0.95, 0.3, 0.05), 0.16);

    vec3 e = vec3(abs(p.x) - 2.6, p.y, p.z + 0.05);
    vec2 we = vec2(length(e.yz) - 0.42, abs(e.x) - 0.06);
    float ear = min(max(we.x, we.y), 0.0) + length(max(we, 0.0)) - 0.2;
    sh = smin(sh, ear, 0.05);
    if (!fine) return vec2(sh, 1.0);

    // The screen: a domed round pillow sitting proud in that bed.
    vec2 n = v / vec2(1.98, 1.76);
    float sz = p.z - 0.62 + 0.12 * dot(n, n);
    float scr = extrude(sdEll2(v, vec2(1.98, 1.76)), sz, 0.34, 0.17) * 0.9;
    return sh < scr ? vec2(sh, 1.0) : vec2(scr, 2.0);
}

/* body space: origin between the feet */
#define SHOULDER vec3(1.017, 1.62, 0.05)

float body(vec3 p) {
    // Walking lifts one foot: the lower body on that side rises, fading
    // out by the waist, so the step reads without separate legs.
    float lift = mix(uFeet.x, uFeet.y, smoothstep(-0.3, 0.3, p.x));
    vec3 q = p;
    q.y -= lift * (1.0 - smoothstep(0.0, 1.0, q.y));
    float d = sdRBox(q - vec3(0.0, 1.05, 0.0), vec3(0.99, 1.05, 0.72), 0.5);
    // Arch between the feet: a low triangle, blended wide, so the flanks
    // flare into the feet and the peak rounds over.
    vec2 ta = vec2(abs(q.x), q.y + 0.06);
    float tri = max(dot(ta, vec2(0.33, 0.944)) - 0.3 * 0.944, -ta.y);
    d = smax(d, -max(tri, abs(q.z) - 1.4), 0.17);
    // The squeeze above stretches distances by up to lift / waist.
    d *= 1.0 - 1.1 * max(uFeet.x, uFeet.y);

    // Arms hinge at the shoulder: swing forward/back, then raise outward.
    // At (0.28, 0) this is exactly the hanging nub of the still.
    vec2 arm = p.x > 0.0 ? uArms.zw : uArms.xy;
    // A waving arm stretches like soft clay, so the hand clears the helmet.
    float ext = p.x > 0.0 ? uArmExt.y : uArmExt.x;
    vec3 a = p;
    a.x = abs(a.x);
    a -= SHOULDER;
    float c1 = cos(arm.y), s1 = sin(arm.y);
    a.yz = mat2(c1, s1, -s1, c1) * a.yz;
    float c2 = cos(arm.x), s2 = sin(arm.x);
    a.xy = vec2(a.x * c2 + a.y * s2, -a.x * s2 + a.y * c2);
    a.y += 0.3 + 0.5 * ext;
    return smin(d, sdEll(a, vec3(0.24 - 0.03 * ext, 0.37 + 0.5 * ext, 0.25 - 0.03 * ext)), 0.06);
}

vec3 toBody(vec3 ps) {
    vec3 pr = ps;
    pr.x -= uWalkX;
    pr.y -= uHop;
    pr /= vec3(uSq.x, uSq.y, uSq.x);
    return uBody * pr;
}
vec3 toHead(vec3 pr) { return uHead * (pr - PIVOT) + PIVOT - HEAD_C; }

#define HEAD_B vec3(2.9, 2.32, 1.0)
#define BODY_C vec3(0.0, uBodyBox.x, 0.0)
#define BODY_B uBodyBox.yzw
// Beyond this, no probe (occlusion, sky, normal) can tell the box from
// the part, so the box distance may stand in for it.
#define REACH 1.5

/* Scene distance (scene units) and material id. A part is evaluated
   only if its box is nearer than the best distance so far, which leaves
   the union exact; boxes stand in only when everything is out of reach. */
vec2 sceneD(vec3 ps, bool fine) {
    float kq = min(uSq.x, uSq.y);
    vec3 pr = toBody(ps);
    vec3 ph = toHead(pr);
    float bh = sdBox(ph, HEAD_B) * kq;
    float bb = sdBox(pr - BODY_C, BODY_B) * kq;
    float far = min(bh, bb);
    if (far > REACH) return vec2(far, 1.0);
    vec2 res = vec2(1e5, 1.0);
    if (bh < bb) {
        res = head(ph, fine);
        res.x *= kq;
        if (bb < res.x) {
            float d = body(pr) * kq;
            if (d < res.x) res = vec2(d, 1.0);
        }
    } else {
        res = vec2(body(pr) * kq, 1.0);
        if (bh < res.x) {
            vec2 h = head(ph, fine);
            h.x *= kq;
            if (h.x < res.x) res = h;
        }
    }
    return res;
}

float mapD(vec3 p) { return sceneD(uW2S * p, true).x * uScale; }
float mapC(vec3 p) { return sceneD(uW2S * p, false).x * uScale; }

// Forward differences against the distance the march already has.
vec3 calcN(vec3 p, float d0, float e) {
    return normalize(vec3(
        mapD(p + vec3(e, 0.0, 0.0)),
        mapD(p + vec3(0.0, e, 0.0)),
        mapD(p + vec3(0.0, 0.0, e))) - d0);
}

// Ray against the scene box, in world t. Scene space is a linear map of
// world space, so the same t serves both.
vec2 boxT(vec3 ro, vec3 rd) {
    vec3 o = uW2S * ro;
    vec3 d = uW2S * rd;
    vec3 inv = 1.0 / d;
    vec3 t0 = (uBoxMin - o) * inv;
    vec3 t1 = (uBoxMax - o) * inv;
    vec3 lo = min(t0, t1), hi = max(t0, t1);
    return vec2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
}

// Ray against a box (centre c, half size b) in whatever space o, d are.
vec2 slab(vec3 o, vec3 d, vec3 c, vec3 b) {
    vec3 inv = 1.0 / d;
    vec3 t0 = (c - b - o) * inv;
    vec3 t1 = (c + b - o) * inv;
    vec3 lo = min(t0, t1), hi = max(t0, t1);
    return vec2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
}
vec2 spanWith(vec2 s, vec2 b) {
    return b.y > max(b.x, 0.0) ? vec2(min(s.x, b.x), max(s.y, b.y)) : s;
}

float softShadow(vec3 ro, vec3 rd) {
    vec2 bt = boxT(ro, rd);
    if (bt.y <= max(bt.x, 0.0)) return 1.0;
    // Classic k*h/t penumbra. The "improved" variant speckles on rays
    // that graze the blended (inexact) parts of this field.
    float t = max(bt.x, 0.03 * uScale);
    float res = 1.0;
    for (int i = 0; i < 20; i++) {
        float h = mapC(ro + rd * t);
        res = min(res, uSoft * h / t);
        t += clamp(h, 0.04 * uScale, 0.8 * uScale);
        if (res < 0.003 || t > bt.y) break;
    }
    res = clamp(res, 0.0, 1.0);
    return res * res * (3.0 - 2.0 * res);
}

float calcAO(vec3 p, vec3 n) {
    float occ = 0.0, sc = 1.0;
    for (int i = 0; i < 5; i++) {
        float h = (0.03 + 0.14 * float(i)) * uScale;
        occ += (h - mapD(p + n * h)) * sc;
        sc *= 0.72;
    }
    // Floored: a crease reads as a soft line, not a black cut.
    return mix(0.3, 1.0, clamp(1.0 - uAO * 1.5 * occ / uScale, 0.0, 1.0));
}

// Large-scale sky occlusion: three long probes up and out along the
// normal. This is what darkens the body under the overhanging helmet.
float skyVis(vec3 p, vec3 n) {
    vec3 dir = normalize(n + vec3(0.0, 1.0, 0.0));
    float occ = 0.0;
    for (int i = 0; i < 3; i++) {
        float h = (0.4 + 0.5 * float(i)) * uScale;
        occ += clamp(1.0 - mapC(p + dir * h) / h, 0.0, 1.0);
    }
    return 1.0 - uAO * 0.5 * occ / 3.0;
}

float eyeSD(vec2 p) {
    vec2 q = p - vec2(uEye.x, -0.5 + uEye.y);
    q.x = abs(q.x) - 0.5;
    float hy = max(0.4 * uEye.z, 0.03);
    float rect = sdRR(q, vec2(0.39, hy), min(0.13, hy));
    float arc = sdArc(q + vec2(0.0, 0.15), vec2(0.906, 0.423), 0.28, 0.07);
    return mix(rect, arc, uEye.w);
}

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec3 ro = vec3(0.0, CAM_Y, uD);
    // world units per buffer pixel, per unit of distance
    float pxk = FRAME_UNITS / (uS * uD);
    vec3 os = uW2S * ro;
    vec3 sqv = vec3(uSq.x, uSq.y, uSq.x);
    vec3 ob = uBody * ((os - vec3(uWalkX, uHop, 0.0)) / sqv);
    vec3 ohd = uHead * (ob - PIVOT) + PIVOT - HEAD_C;
    float kq = min(uSq.x, uSq.y);

    // Cyc gradient lives on the frame, so Placement never moves it.
    float v = 1.0 - gl_FragCoord.y / uRes.y;
    vec3 bg = mix(uBgTop, uBgBot, 1.0 - pow(1.0 - v, uCurve));

    // Edge-adaptive supersampling. Every pixel traces and shades its
    // centre. A pixel that turns out to sit on an edge -- a near miss, a
    // grazing hit, or a hit that brushed past something nearer on the way
    // -- traces four more rays on a rotated grid. Those only decide
    // coverage: one landing on the centre's surface reuses its colour, and
    // at most one other colour is shaded per pixel. They also start where
    // the centre ray first came within 1.5 px of anything (nothing nearer
    // can lie 0.4 px to the side) and stop early, because grazing rays
    // crawl and every lane in the warp waits on them. One loop, one march,
    // one shading block, no derivatives (ANGLE zeroes them in such loops).
    vec3 acc = vec3(0.0);
    float cnt = 0.0;
    bool edge = false;
    vec3 colC = bg, colO = bg;
    float alC = 1.0, alO = 1.0, accA = 0.0;
    bool hitC = false, haveO = false;
    float idC = 0.0, tWarm = 0.0;
    // The bound is a uniform (always 5) so the compiler cannot unroll
    // five copies of the march.
    for (int s = 0; s < uSamples; s++) {
        if (s > 0 && !edge) break;
        float a = 0.4636 + float(s - 1) * 1.5708;
        vec2 off = s == 0 ? vec2(0.0) : 0.395 * vec2(cos(a), sin(a));
        vec2 fc = gl_FragCoord.xy + off - 0.5 * uRes - uOff;
        vec2 q = fc / uS * FRAME_UNITS - vec2(0.0, ROLL_CY);
        q = mat2(uRoll.x, uRoll.y, -uRoll.y, uRoll.x) * q + vec2(0.0, ROLL_CY);
        vec3 rd = normalize(vec3(q, -uD));
        float tf = rd.y < 0.0 ? -ro.y / rd.y : 1e9;

        // March only where the ray crosses a part's box: head (in head
        // space, so it turns with it) and body.
        vec3 ds = uW2S * rd;
        vec3 db = uBody * (ds / sqv);
        vec2 span = vec2(1e9, -1e9);
        span = spanWith(span, slab(ohd, uHead * db, vec3(0.0), HEAD_B + 0.02));
        span = spanWith(span, slab(ob, db, BODY_C, BODY_B + 0.02));
        bool hit = false;
        float t = max(max(span.x, 0.0), tWarm);
        float tEnd = min(span.y, tf);
        float hitAt = s == 0 ? 0.25 : 0.4;
        int steps = s == 0 ? 96 : 40;
        // rmin: closest approach of a miss. near: a closest approach the
        // ray then pulled away from -- something it brushed past.
        float rmin = 1e9, near = 1e9, prevR = 1e9;
        vec2 hitD = vec2(0.0, 1.0);
        if (tEnd > t) {
            // Over-relaxed sphere tracing (Keinert et al. 2014): step 1.4x
            // the distance while successive spheres overlap, else step
            // back and continue plainly.
            float w = 1.4, lastD = 0.0, step = 0.0;
            for (int i = 0; i < 96; i++) {
                if (i >= steps) break;
                vec2 dd = sceneD(uW2S * (ro + rd * t), true);
                float d = dd.x * uScale;
                bool fail = w > 1.0 && d + lastD < step;
                if (fail) {
                    step -= w * step;
                    w = 1.0;
                } else {
                    float fp = pxk * t;
                    if (d < hitAt * fp) { hit = true; hitD = vec2(d, dd.y); break; }
                    float r = d / fp;
                    if (s == 0 && r < 1.5 && rmin >= 1.5) tWarm = t;
                    rmin = min(rmin, r);
                    if (r > prevR) near = min(near, prevR);
                    prevR = r;
                    step = d * w;
                }
                lastD = d;
                t += step;
                if (t > tEnd) break;
            }
            if (s == 0 && hit && rmin >= 1.5) tWarm = t;
        }

        bool same = s > 0 && hit == hitC && (!hit || abs(hitD.y - idC) < 0.5);
        vec3 col = same ? colC : colO;
        float al = same ? alC : alO;
        if (s == 0 || (!same && !haveO)) {
            col = bg;
            al = 1.0;
            vec3 n = vec3(0.0, 1.0, 0.0);
            vec3 p = ro + rd * t;
            vec3 pf = ro + rd * min(tf, 1e4);
            float ao = 1.0;
            float ndl = 0.0;
            if (hit) {
                n = calcN(p, hitD.x, max(pxk * t * 0.5, 0.0015 * uScale));
                ao = calcAO(p, n) * skyVis(p, n);
                ndl = dot(n, uSun);
            }
            // One shadow trace: from the surface if there is one, else
            // from the floor behind it.
            bool wantSh = hit ? ndl > 0.03 : tf < 1e8;
            float sh = wantSh ? softShadow(hit ? p + n * 0.01 * uScale : pf, uSun) : (hit ? 0.0 : 1.0);
            // Shadow depth lightens the sun's shadow on the robot itself.
            if (hit) sh = mix(1.0, sh, uShDepth);

            if (hit) {
                float id = hitD.y;
                vec3 alb = id > 1.5 ? uVisor : uClay;
                vec2 sxz = normalize(uSun.xz + 1e-5);
                // Sky dome as a linear fit in the normal: a flat fill, a
                // share from above and a share from each side of the sun.
                float side = dot(n.xz, sxz);
                vec3 lit = (uSky + uSkyUp * n.y + uSkySide * max(side, 0.0) + uSkyAway * max(-side, 0.0)) * ao
                         + uSunCol * max(ndl, 0.0) * sh;
                col = pow(max(alb * lit, 0.0), vec3(1.0 / 2.2));
                if (id > 1.5 && id < 2.5) {
                    // Eyes: a 2-D shape on the screen, anti-aliased over
                    // the pixel's footprint in head units.
                    vec3 ph = toHead(toBody(uW2S * p));
                    float eD = eyeSD(ph.xy);
                    float eW = 0.75 * pxk * t / (uScale * kq);
                    float eye = 1.0 - smoothstep(-eW, eW, eD);
                    float front = smoothstep(0.3, 0.5, ph.z);
                    float halo = uGlow * exp(-max(eD, 0.0) * 7.0) * (1.0 - eye);
                    col += uEyeCol * halo * 0.35 * front;
                    col = mix(col, uEyeCol, eye * front);
                }
                if (s == 0) edge = near < 1.5 || dot(n, -rd) < 0.3;
            } else {
                if (tf < 1e8) {
                    vec3 fs = uW2S * pf;
                    vec3 m = clamp(fs, uBoxMin, uBoxMax);
                    if (distance(fs.xz, m.xz) < 0.6) {
                        float h = 0.3 * uScale;
                        sh *= mix(0.55, 1.0, clamp(mapD(pf + vec3(0.0, h, 0.0)) / h, 0.0, 1.0));
                    }
                    col = mix(uShadowCol, bg, 1.0 - (1.0 - sh) * uShDepth);
                }
                // Transparent backdrop: only the shadow is left of the floor,
                // as a premultiplied tint; everything else is clear.
                if (uClear > 0.5) {
                    al = tf < 1e8 ? (1.0 - sh) * uShDepth : 0.0;
                    col = uShadowCol * al;
                }
                // A ray stopped by the floor inside a part's box never
                // reaches its closest approach; measure it where it lands.
                if (s == 0) {
                    if (tf <= span.y) rmin = min(rmin, mapD(pf) / (pxk * tf));
                    edge = rmin < 1.5;
                }
            }
            if (s == 0) {
                colC = col;
                alC = al;
                hitC = hit;
                idC = hitD.y;
            } else {
                colO = col;
                alO = al;
                haveO = true;
            }
        }
        acc += col;
        accA += al;
        cnt += 1.0;
    }
    vec3 col = acc / cnt;
    if (uClear > 0.5) {
        fragColor = vec4(col, accA / cnt);
        return;
    }

    col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    fragColor = vec4(col, 1.0);
}
`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
    const sh = gl.createShader(type)
    if (!sh) return null
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh)
        return null
    }
    return sh
}

/* --------------------------------------------------------------- maths */

// Row-major 3x3 rotations written into a caller's buffer (no per-frame
// allocation). Uploading a row-major array to a GLSL mat3 hands the
// shader its transpose -- for a rotation, the inverse.
type M3 = Float32Array
function rotX(a: number, o: M3): M3 {
    const c = Math.cos(a), s = Math.sin(a)
    o[0] = 1; o[1] = 0; o[2] = 0
    o[3] = 0; o[4] = c; o[5] = -s
    o[6] = 0; o[7] = s; o[8] = c
    return o
}
function rotY(a: number, o: M3): M3 {
    const c = Math.cos(a), s = Math.sin(a)
    o[0] = c; o[1] = 0; o[2] = s
    o[3] = 0; o[4] = 1; o[5] = 0
    o[6] = -s; o[7] = 0; o[8] = c
    return o
}
function rotZ(a: number, o: M3): M3 {
    const c = Math.cos(a), s = Math.sin(a)
    o[0] = c; o[1] = -s; o[2] = 0
    o[3] = s; o[4] = c; o[5] = 0
    o[6] = 0; o[7] = 0; o[8] = 1
    return o
}
function mul3(a: M3, b: M3, out: M3) {
    for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++)
            out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
}

/** Critically damped spring, settling in about `T` seconds. */
interface Spring {
    x: number
    v: number
}
function stepSpring(s: Spring, target: number, T: number, dt: number) {
    const w = 5.8 / Math.max(T, 0.02)
    let left = dt
    while (left > 0) {
        const h = Math.min(left, 0.004)
        const a = w * w * (target - s.x) - 2 * w * s.v
        s.v += a * h
        s.x += s.v * h
        left -= h
    }
}
const springBusy = (s: Spring, target: number) =>
    Math.abs(s.x - target) > 1e-4 || Math.abs(s.v) > 1e-3

// Seeded so the idle behaviour is the same on every load (and on the
// server and client alike -- nothing random touches the first render).
function makeRandom(seed: number) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** Squash (+) / stretch (-) and lift through a hop, `h` seconds in. */
function hopPose(h: number, height: number): { lift: number; squash: number; done: boolean } {
    if (h < HOP_CROUCH) {
        return { lift: 0, squash: 0.13 * Math.sin((Math.PI / 2) * (h / HOP_CROUCH)), done: false }
    }
    const a = h - HOP_CROUCH
    if (a < HOP_AIR) {
        const u = a / HOP_AIR
        return { lift: 4 * height * u * (1 - u), squash: -0.09 * (1 - 2 * u) * (1 - 2 * u) + 0.13 * Math.max(0, 1 - a / 0.06), done: false }
    }
    return landPose(a - HOP_AIR)
}
function landPose(l: number): { lift: number; squash: number; done: boolean } {
    if (l > LAND_S) return { lift: 0, squash: 0, done: true }
    const env = Math.exp(-l * 7) * (1 - l / LAND_S)
    return { lift: 0, squash: 0.16 * env * Math.cos(l * 19), done: false }
}

/* ----------------------------------------------------------- component */

/**
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 * @framerIntrinsicWidth 1200
 * @framerIntrinsicHeight 900
 */
export default function ClayRobot({
    background = {"top":"#909EA9","bottom":"#CCD0D3","shadow":"#2E4D6A","shadowDepth":24},
    colors = {"clay":"#B5A1FF","eyes":"#FFFFFF","visor":"#22225E"},
    scale = DEFAULTS.scale,
    placement = {"x":0,"y":0,"tilt":0,"angle":0},
    animate = DEFAULTS.animate,
    delay = DEFAULTS.delay,
    response = {"hop":6,"track":"page","headTurn":7,"eyeTravel":6,"followSpeed":6},
    walk = DEFAULTS.walk,
    walkSpeed = DEFAULTS.walkSpeed,
    wave = DEFAULTS.wave,
    glance = DEFAULTS.glance,
    blink = DEFAULTS.blink,
    advanced = {"eyeGlow":0.6,"sunAngle":90,"occlusion":1,"skyStrength":1,"sunStrength":1,"sunElevation":25,"gradientCurve":1.3,"cameraDistance":30,"shadowSoftness":6},
    transparent = false,
    style,
}: ClayRobotProps) {
    const bgc = { ...DEFAULT_BACKGROUND, ...background }
    const col = { ...DEFAULT_COLORS, ...colors }
    const place = { ...DEFAULT_PLACEMENT, ...placement }
    const resp = { ...DEFAULT_RESPONSE, ...response }
    const adv = { ...DEFAULT_ADVANCED, ...advanced }

    const hostRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [failed, setFailed] = useState(false)

    // Live mirror read by the loop, so a control drag never rebuilds GL.
    const live = { bgc, col, place, resp, adv, scale, animate, delay, walk, walkSpeed, wave, glance, blink, transparent }
    const propsRef = useRef(live)
    propsRef.current = live
    const wakeRef = useRef<() => void>(() => {})
    const propKey = JSON.stringify(live)
    useEffect(() => {
        wakeRef.current()
    }, [propKey])

    useEffect(() => {
        const host = hostRef.current
        const canvas = canvasRef.current
        if (!host || !canvas) return

        let disposed = false
        let raf = 0
        let gl: WebGL2RenderingContext | null = null
        let program: WebGLProgram | null = null
        let buffer: WebGLBuffer | null = null
        let vao: WebGLVertexArrayObject | null = null
        const uni: Record<string, WebGLUniformLocation | null> = {}
        let timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null
        const queries: { q: WebGLQuery; level: number }[] = []

        // Layout size (CSS px) and on-screen scale.
        let layoutW = 1
        let layoutH = 1
        let shown = 1
        let needResize = true

        let onScreen = true
        let pageVisible = true
        let reduceMotion = false

        // Pointer, as recorded by the handlers; turned into a target once
        // per frame.
        let ptrX = 0
        let ptrY = 0
        let ptrNew = false
        let ptrInFrame = false
        let ptrInPage = false
        let ptrSeen = false
        let touchUntil = 0
        let scrolled = false
        let ptrU = 0.5
        let ptrV = 0.5

        // Motion state.
        const yaw: Spring = { x: 0, v: 0 }
        const pitch: Spring = { x: 0, v: 0 }
        const bodyYaw: Spring = { x: 0, v: 0 }
        const eyeX: Spring = { x: 0, v: 0 }
        const eyeY: Spring = { x: 0, v: 0 }
        let tYaw = 0, tPitch = 0, tEyeX = 0, tEyeY = 0
        let clock = 0
        let hopAt = -1
        let joyAt = -1
        let blinkAt = -1
        let nextBlink = 2.2
        let nextGlance = 1.6
        let glanceYaw = 0
        let glancePitch = 0
        let dropAt = -1
        let dropDone = false
        // Walk: position along the floor (scene units), speed, goal, gait
        // phase and how much of the gait is showing.
        let walkX = 0
        let walkV = 0
        let walkGoal = 0
        let gait = 0
        let walkAmt = 0
        let ptrFloorX = 0
        let lastActive = -1e9
        let wasActive = false
        // Wave: when it started and which arm (+1 = screen right).
        let waveAt = -1
        let waveSide = 1
        let greet = false
        const rand = makeRandom(0x5eed)

        // Pacing (whole vsyncs) and the quality ladder.
        const gaps = new Float64Array(15)
        const sortBuf = new Float64Array(15)
        let gapN = 0
        let lastTick = 0
        let lastDraw = 0
        let every = 1
        let ticksSince = 0
        let dirty = true
        let wasBusy = false
        let level = 0
        let slowFor = 0
        let goodFor = 0
        let climbedAt = -1
        const banUntil = [0, 0, 0, 0]
        let lateEma = 1
        let gpuEma = 0
        let drawn = 0
        let rectCheck = 0

        const mHead = new Float32Array(9)
        const mBody = new Float32Array(9)
        const mW2S = new Float32Array(9)
        const tmp = new Float32Array(9)
        const tA = new Float32Array(9)
        const tB = new Float32Array(9)

        function init(): boolean {
            const ctx = canvas!.getContext("webgl2", {
                alpha: propsRef.current.transparent,
                premultipliedAlpha: true,
                antialias: false,
                depth: false,
                stencil: false,
                powerPreference: "low-power",
                preserveDrawingBuffer: false,
            }) as WebGL2RenderingContext | null
            if (!ctx) return false
            gl = ctx
            const vs = compile(gl, gl.VERTEX_SHADER, VERT)
            const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
            if (!vs || !fs) return false
            const prog = gl.createProgram()
            if (!prog) return false
            gl.attachShader(prog, vs)
            gl.attachShader(prog, fs)
            gl.bindAttribLocation(prog, 0, "aPos")
            gl.linkProgram(prog)
            gl.deleteShader(vs)
            gl.deleteShader(fs)
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false
            program = prog
            gl.useProgram(prog)
            vao = gl.createVertexArray()
            gl.bindVertexArray(vao)
            buffer = gl.createBuffer()
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
            gl.enableVertexAttribArray(0)
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
            const names = [
                "uRes", "uS", "uOff", "uRoll", "uD", "uW2S", "uScale", "uHop", "uSq",
                "uBody", "uHead", "uEye", "uBoxMin", "uBoxMax", "uSun", "uSunCol", "uSky",
                "uSkyUp", "uSkySide", "uSkyAway", "uSoft", "uAO", "uBgTop", "uBgBot", "uCurve", "uShadowCol", "uShDepth", "uClay",
                "uVisor", "uEyeCol", "uGlow", "uSamples", "uWalkX", "uFeet", "uArms", "uArmExt", "uBodyBox", "uClear",
            ]
            for (const n of names) uni[n] = gl.getUniformLocation(prog, n)
            timerExt = gl.getExtension("EXT_disjoint_timer_query_webgl2") as typeof timerExt
            queries.length = 0
            needResize = true
            dirty = true
            return true
        }

        /** Applied right before a draw, so a wiped buffer is never shown. */
        function applySize() {
            if (!gl) return
            const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
            let k = dpr * Math.min(Math.max(shown, 1), 2)
            const area = layoutW * layoutH * k * k
            if (area > PIXEL_BUDGET) k *= Math.sqrt(PIXEL_BUDGET / area)
            // The ladder scales what the budget allows, so every step bites.
            k *= LEVELS[level]
            const w = Math.max(1, Math.round(layoutW * k))
            const h = Math.max(1, Math.round(layoutH * k))
            if (canvas!.width !== w || canvas!.height !== h) {
                canvas!.width = w
                canvas!.height = h
            }
            gl.viewport(0, 0, w, h)
            needResize = false
        }

        function measureShown() {
            const r = host!.getBoundingClientRect()
            if (layoutW > 0 && r.width > 0) {
                const s = r.width / layoutW
                if (Math.abs(s - shown) / shown > 0.05) {
                    shown = s
                    needResize = true
                    dirty = true
                }
            }
            return r
        }

        /** Pointer → head and eye targets, through the same camera as the shader. */
        function aimAt(u: number, v: number) {
            const p = propsRef.current
            const W = layoutW, H = layoutH
            const S = Math.min(H, W / REF_ASPECT)
            const ang = (p.place.angle * Math.PI) / 180
            const fx = u * W - W / 2 - (p.place.x / 100) * W
            const fy = H / 2 - v * H + (p.place.y / 100) * H
            let qx = (fx / S) * FRAME_UNITS
            let qy = (fy / S) * FRAME_UNITS - ROLL_CY
            const c = Math.cos(ang), s = Math.sin(ang)
            const rx = c * qx - s * qy
            const ry = s * qx + c * qy + ROLL_CY
            qx = rx
            qy = ry
            // At the robot's depth the ray is still at q: that is where on
            // the floor the cursor is, for the walk.
            ptrFloorX = qx / (p.scale / 100)
            const D = p.adv.cameraDistance
            const len = Math.hypot(qx, qy, D)
            const dx = qx / len, dy = qy / len, dz = -D / len
            const tt = (LOOK_Z - D) / dz
            let Tx = dx * tt, Ty = CAM_Y + dy * tt, Tz = D + dz * tt
            // world -> scene: undo scale, then tilt
            const k = p.scale / 100
            Tx /= k; Ty /= k; Tz /= k
            const tl = (-p.place.tilt * Math.PI) / 180
            const ct = Math.cos(tl), st = Math.sin(tl)
            const sy = ct * Ty + st * Tz
            const sz = -st * Ty + ct * Tz
            const ox = Tx - walkX, oy = sy - HEAD_Y, oz = sz
            const yawRaw = Math.atan2(ox, Math.max(oz, 0.5))
            const pitchRaw = Math.atan2(oy, Math.hypot(ox, oz))
            setAim(yawRaw, pitchRaw)
        }

        function setAim(yawRaw: number, pitchRaw: number) {
            const p = propsRef.current
            const maxYaw = (p.resp.headTurn / 10) * 0.87
            const maxPitch = maxYaw * 0.55
            tYaw = maxYaw > 0 ? maxYaw * Math.tanh(yawRaw / maxYaw) : 0
            tPitch = maxPitch > 0 ? maxPitch * Math.tanh(pitchRaw / maxPitch) : 0
            const et = p.resp.eyeTravel / 10
            tEyeX = et * EYE_X * Math.tanh(yawRaw / 0.55)
            const py = Math.tanh(pitchRaw / 0.4)
            tEyeY = et * (py > 0 ? EYE_UP : EYE_DOWN) * py
        }

        /** How far either way the robot can walk and stay inside the frame. */
        function walkRange(out: number[]) {
            const p = propsRef.current
            const W = layoutW, H = layoutH
            const S = Math.min(H, W / REF_ASPECT)
            const k = p.scale / 100
            const off = (p.place.x / 100) * W
            const lo = (((-W / 2 - off) / S) * FRAME_UNITS) / k + WALK_MARGIN
            const hi = (((W / 2 - off) / S) * FRAME_UNITS) / k - WALK_MARGIN
            out[0] = lo > hi ? (lo + hi) / 2 : lo
            out[1] = lo > hi ? (lo + hi) / 2 : hi
        }
        const range = [0, 0]

        function startWave(side: number) {
            const p = propsRef.current
            if (!p.wave || reduceMotion || waveAt >= 0) return
            waveAt = clock
            waveSide = side >= 0 ? 1 : -1
        }

        /** 0 hanging .. 1 raised, through a wave. */
        function waveUp(w: number): number {
            const ease = (x: number) => x * x * (3 - 2 * x)
            if (w < WAVE_UP) return ease(w / WAVE_UP)
            if (w < WAVE_UP + WAVE_HOLD) return 1
            if (w < WAVE_UP + WAVE_HOLD + WAVE_DOWN) return 1 - ease((w - WAVE_UP - WAVE_HOLD) / WAVE_DOWN)
            return 0
        }

        function draw() {
            if (!gl || !program) return
            const p = propsRef.current
            if (needResize) applySize()
            const W = canvas!.width, H = canvas!.height
            const bs = W / layoutW
            const S = Math.min(layoutH, layoutW / REF_ASPECT) * bs

            // Hop / drop / joy / blink poses.
            let lift = 0
            let squash = 0
            if (dropAt >= 0 && !dropDone) {
                const d = clock - dropAt
                if (d < 0) lift = DROP_FROM
                else if (d < DROP_S) {
                    const u = d / DROP_S
                    lift = DROP_FROM * (1 - u * u)
                    squash = -0.08 * u
                } else {
                    const lp = landPose(d - DROP_S)
                    squash = lp.squash
                    if (lp.done) dropDone = true
                }
            }
            const hopH = (p.resp.hop / 10) * 1.6
            if (hopAt >= 0) {
                const hp = hopPose(clock - hopAt, hopH)
                lift += hp.lift
                squash += hp.squash
                if (hp.done) hopAt = -1
            }
            let joy = 0
            if (joyAt >= 0) {
                const j = clock - joyAt
                joy = j < 0.08 ? j / 0.08 : j < JOY_S ? 1 : Math.max(0, 1 - (j - JOY_S) / 0.15)
                if (j > JOY_S + 0.15) joyAt = -1
            }
            // Gait: foot lifts alternate, the body rocks onto the planted
            // foot and rises a little mid-step, the arms counter-swing.
            const gs = Math.sin(gait)
            lift += walkAmt * BOB * Math.abs(gs)
            const roll = -walkAmt * WADDLE * gs
            const liftL = walkAmt * STEP_LIFT * Math.max(0, gs)
            const liftR = walkAmt * STEP_LIFT * Math.max(0, -gs)
            let armL = ARM_REST, armR = ARM_REST
            let swingL = walkAmt * ARM_SWING * gs
            let swingR = -swingL
            let extL = 0, extR = 0
            if (waveAt >= 0) {
                const w = clock - waveAt
                const up = waveUp(w)
                const sway = WAVE_SWAY * up * up * Math.sin((w - WAVE_UP) * Math.PI * 2 * WAVE_HZ)
                const raise = ARM_REST + (WAVE_RAISE - ARM_REST) * up + sway
                if (waveSide > 0) {
                    armR = raise
                    swingR *= 1 - up
                    extR = up
                } else {
                    armL = raise
                    swingL *= 1 - up
                    extL = up
                }
                joy = Math.max(joy, up)
                if (w > WAVE_UP + WAVE_HOLD + WAVE_DOWN) waveAt = -1
            }

            let open = 1
            if (blinkAt >= 0) {
                const b = (clock - blinkAt) / BLINK_S
                if (b >= 1) blinkAt = -1
                else open = 1 - 0.94 * Math.sin(Math.PI * b)
            }
            if (dropAt >= 0 && !dropDone && clock - dropAt < DROP_S + 0.1) open = 0.12

            // Matrices.
            const k = p.scale / 100
            const tilt = (-p.place.tilt * Math.PI) / 180
            rotX(tilt, mW2S)
            for (let i = 0; i < 9; i++) mW2S[i] /= k
            const hy = yaw.x - bodyYaw.x
            mul3(rotY(hy, tA), rotX(-pitch.x, tB), tmp)
            mul3(tmp, rotZ(HEAD_ROLL * hy, tA), mHead)
            mul3(rotY(bodyYaw.x, tA), rotZ(roll, tB), mBody)

            const az = (p.adv.sunAngle * Math.PI) / 180
            const el = (p.adv.sunElevation * Math.PI) / 180
            const sunX = Math.sin(az) * Math.cos(el)
            const sunY = Math.sin(el)
            const sunZ = Math.cos(az) * Math.cos(el)

            const bgTop = toRGB(p.bgc.top, DEFAULT_BACKGROUND.top)
            const bgBot = toRGB(p.bgc.bottom, DEFAULT_BACKGROUND.bottom)
            const shc = toRGB(p.bgc.shadow, DEFAULT_BACKGROUND.shadow)
            const clay = toRGB(p.col.clay, DEFAULT_COLORS.clay)
            const visor = toRGB(p.col.visor, DEFAULT_COLORS.visor)
            const eyes = toRGB(p.col.eyes, DEFAULT_COLORS.eyes)
            const ss = p.adv.sunStrength
            const sk = p.adv.skyStrength

            const g = gl
            g.useProgram(program)
            g.uniform2f(uni.uRes, W, H)
            g.uniform1f(uni.uS, S)
            g.uniform2f(uni.uOff, (p.place.x / 100) * W, (-p.place.y / 100) * H)
            const ang = (p.place.angle * Math.PI) / 180
            g.uniform2f(uni.uRoll, Math.cos(ang), Math.sin(ang))
            g.uniform1f(uni.uD, p.adv.cameraDistance)
            g.uniformMatrix3fv(uni.uW2S, false, mW2S)
            g.uniform1f(uni.uScale, k)
            g.uniform1f(uni.uHop, lift)
            const sq = Math.max(-0.3, Math.min(0.4, squash))
            g.uniform2f(uni.uSq, 1 + sq * 0.5, 1 - sq)
            g.uniformMatrix3fv(uni.uBody, false, mBody)
            g.uniformMatrix3fv(uni.uHead, false, mHead)
            g.uniform4f(uni.uEye, eyeX.x, eyeY.x, open, joy)
            g.uniform3f(uni.uBoxMin, walkX - 3.25, -0.05, -2.7)
            g.uniform3f(uni.uBoxMax, walkX + 3.25, 6.55 + lift + Math.max(0, -sq) * 6, 2.7)
            g.uniform3f(uni.uSun, sunX, sunY, sunZ)
            g.uniform3f(uni.uSunCol, SUN[0] * ss, SUN[1] * ss, SUN[2] * ss)
            g.uniform3f(uni.uSky, SKY[0] * sk, SKY[1] * sk, SKY[2] * sk)
            g.uniform3f(uni.uSkyUp, SKY_UP[0] * sk, SKY_UP[1] * sk, SKY_UP[2] * sk)
            g.uniform3f(uni.uSkySide, SKY_SIDE[0] * sk, SKY_SIDE[1] * sk, SKY_SIDE[2] * sk)
            g.uniform3f(uni.uSkyAway, SKY_AWAY[0] * sk, SKY_AWAY[1] * sk, SKY_AWAY[2] * sk)
            g.uniform1f(uni.uSoft, p.adv.shadowSoftness)
            g.uniform1f(uni.uAO, p.adv.occlusion)
            g.uniform3f(uni.uBgTop, bgTop[0], bgTop[1], bgTop[2])
            g.uniform3f(uni.uBgBot, bgBot[0], bgBot[1], bgBot[2])
            g.uniform1f(uni.uCurve, p.adv.gradientCurve)
            g.uniform3f(uni.uShadowCol, shc[0], shc[1], shc[2])
            const shDepth = p.bgc.shadowDepth ?? DEFAULT_BACKGROUND.shadowDepth
            g.uniform1f(uni.uShDepth, Math.max(0, Math.min(100, shDepth)) / 100)
            g.uniform3f(uni.uClay, lin(clay[0]) / CLAY_LIN[0], lin(clay[1]) / CLAY_LIN[1], lin(clay[2]) / CLAY_LIN[2])
            g.uniform3f(uni.uVisor, lin(visor[0]) / CLAY_LIN[0], lin(visor[1]) / CLAY_LIN[1], lin(visor[2]) / CLAY_LIN[2])
            g.uniform3f(uni.uEyeCol, eyes[0], eyes[1], eyes[2])
            g.uniform1f(uni.uGlow, p.adv.eyeGlow)
            g.uniform1f(uni.uWalkX, walkX)
            g.uniform2f(uni.uFeet, liftL, liftR)
            g.uniform4f(uni.uArms, armL, swingL, armR, swingR)
            g.uniform2f(uni.uArmExt, extL, extR)
            // The body's box only grows to hold a stretched, raised arm.
            if (extL + extR > 0) g.uniform4f(uni.uBodyBox, 1.48, 3.0, 1.55, 0.9)
            else g.uniform4f(uni.uBodyBox, 1.05, 1.45, 1.12, 0.85)
            g.uniform1i(uni.uSamples, 5)
            g.uniform1f(uni.uClear, p.transparent ? 1 : 0)

            let query: WebGLQuery | null = null
            if (timerExt && queries.length < 4) {
                query = g.createQuery()
                if (query) g.beginQuery(timerExt.TIME_ELAPSED_EXT, query)
            }
            g.drawArrays(g.TRIANGLES, 0, 3)
            if (query && timerExt) {
                g.endQuery(timerExt.TIME_ELAPSED_EXT)
                queries.push({ q: query, level })
            }
            drawn++
        }

        function pollTimer(): number {
            if (!gl || !timerExt || !queries.length) return -1
            const head = queries[0]
            if (!gl.getQueryParameter(head.q, gl.QUERY_RESULT_AVAILABLE)) return -1
            const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT)
            const ns = gl.getQueryParameter(head.q, gl.QUERY_RESULT) as number
            gl.deleteQuery(head.q)
            queries.shift()
            if (disjoint || head.level !== level) return -1
            return ns / 1e6
        }

        /** Quality ladder: step down when frames run late, climb back by probing. */
        function judge(frameMs: number, interval: number, dt: number) {
            if (drawn < 30) return
            const now = clock
            // A slow GPU slows rAF itself, so lateness against the measured
            // cadence can read as on time; GPU time is judged against 60 fps.
            const budget = Math.min(interval, 16.7)
            const g = pollTimer()
            if (g >= 0) gpuEma = gpuEma ? gpuEma * 0.85 + g * 0.15 : g
            lateEma = lateEma * 0.85 + (frameMs / interval) * 0.15
            const slow = timerExt && gpuEma > 0 ? gpuEma > 0.9 * budget : lateEma > 1.3
            const good = timerExt && gpuEma > 0 ? gpuEma < 0.5 * budget : lateEma < 1.08
            if (slow) {
                slowFor += dt
                goodFor = 0
            } else if (good) {
                goodFor += dt
                slowFor = 0
            } else {
                slowFor = 0
                goodFor = 0
            }
            if (slowFor > 0.5 && level < LEVELS.length - 1) {
                if (climbedAt >= 0 && now - climbedAt < 3) banUntil[level] = now + 30
                level++
                climbedAt = -1
                slowFor = 0
                needResize = true
                gpuEma = 0
            } else if (goodFor > 4 && level > 0 && now > banUntil[level - 1]) {
                level--
                climbedAt = now
                goodFor = 0
                needResize = true
                gpuEma = 0
            }
        }

        function wake() {
            if (!dirty) ticksSince = every
            dirty = true
        }
        wakeRef.current = wake

        function loop(now: number) {
            if (disposed) return
            raf = requestAnimationFrame(loop)
            const tickGap = lastTick ? now - lastTick : 16.7
            lastTick = now
            if (!onScreen || !pageVisible) {
                lastDraw = 0
                return
            }
            // Display cadence = median tick gap; draw every Nth vsync.
            if (tickGap > 2 && tickGap < 100) {
                gaps[gapN % 15] = tickGap
                gapN++
            }
            const n = Math.min(gapN, 15)
            let period = 16.7
            if (n >= 5) {
                for (let i = 0; i < n; i++) sortBuf[i] = gaps[i]
                const sub = sortBuf.subarray(0, n).sort()
                period = sub[n >> 1]
            }
            const x = 16.7 / period
            if (x < every - 0.1 || x >= every + 1.1) every = Math.max(1, Math.floor(x + 0.1))
            // Never aim faster than the GPU delivers: a frame that misses its
            // vsync lands on the next one, and the cadence turns uneven.
            const gpuTicks = gpuEma > 0 ? Math.ceil((gpuEma * 1.1) / period) : 1
            const pace = Math.max(every, gpuTicks)
            ticksSince++

            const p = propsRef.current
            const dt = Math.min(tickGap / 1000, 0.05)
            clock += dt
            const rm = reduceMotion

            // Entrance.
            if (dropAt < 0 && !dropDone) {
                if (p.animate && !rm) {
                    dropAt = clock + Math.max(0, p.delay)
                    greet = true
                } else dropDone = true
            }
            if (greet && dropDone) {
                greet = false
                startWave(ptrSeen ? ptrFloorX - walkX : 1)
            }

            // Pointer → targets, reading layout at most once per frame.
            const active =
                p.resp.track === "frame" ? ptrInFrame || clock < touchUntil : ptrInPage || clock < touchUntil
            if ((ptrNew || scrolled) && ptrSeen) {
                const r = measureShown()
                if (r.width > 0 && r.height > 0) {
                    ptrU = (ptrX - r.left) / r.width
                    ptrV = (ptrY - r.top) / r.height
                }
                ptrNew = false
                scrolled = false
            }
            if (active && ptrSeen) {
                aimAt(ptrU, ptrV)
                nextGlance = clock + 2.5
                // A cursor that arrives, or comes back after a while, gets a
                // wave -- once the robot has landed.
                if (!wasActive && clock - lastActive > 3 && dropDone) startWave(ptrFloorX - walkX)
                lastActive = clock
            } else if (p.glance > 0 && !rm) {
                if (clock >= nextGlance) {
                    const home = rand() < 0.3
                    glanceYaw = home ? 0 : (rand() * 2 - 1) * 0.5
                    glancePitch = home ? 0 : (rand() * 1.1 - 0.4) * 0.3
                    nextGlance = clock + (1.4 + rand() * 2.6) * (10 / (4 + p.glance * 1.2))
                }
                setAim(glanceYaw, glancePitch)
            } else {
                setAim(0, 0)
            }

            wasActive = active && ptrSeen

            // Walk goal: under the cursor while it is about, home again
            // once it has been gone a while. A small gap is not worth a
            // walk; a walk under way keeps following.
            if (p.walk && !rm && dropDone) {
                walkRange(range)
                let want = walkGoal
                if (active && ptrSeen) want = ptrFloorX
                else if (clock - lastActive > 4) want = 0
                want = Math.min(range[1], Math.max(range[0], want))
                const walking = Math.abs(walkV) > 0.05
                // It stops to wave, facing the user, and walks on after.
                if (waveAt >= 0) walkGoal = walkX
                else if (walking || Math.abs(want - walkX) > WALK_START) walkGoal = want
            } else {
                walkGoal = 0
                if (!p.walk || rm) {
                    walkX = 0
                    walkV = 0
                    walkAmt = 0
                }
            }
            const faceT = tYaw * BODY_SHARE + Math.sign(walkV) * WALK_TURN * walkAmt

            // Blink.
            if (p.blink && !rm) {
                if (blinkAt < 0 && clock >= nextBlink) {
                    blinkAt = clock
                    nextBlink = clock + (rand() < 0.2 ? 0.28 : 2.2 + rand() * 3.6)
                }
            } else {
                blinkAt = -1
            }

            const busy =
                dirty ||
                springBusy(yaw, tYaw) ||
                springBusy(pitch, tPitch) ||
                springBusy(bodyYaw, faceT) ||
                Math.abs(walkGoal - walkX) > 1e-3 ||
                Math.abs(walkV) > 1e-3 ||
                walkAmt > 1e-3 ||
                waveAt >= 0 ||
                springBusy(eyeX, tEyeX) ||
                springBusy(eyeY, tEyeY) ||
                hopAt >= 0 ||
                joyAt >= 0 ||
                blinkAt >= 0 ||
                (dropAt >= 0 && !dropDone)

            if (!busy) {
                wasBusy = false
                lastDraw = 0
                return
            }
            if (ticksSince < pace && wasBusy) return
            ticksSince = 0

            const sdt = lastDraw ? Math.min((now - lastDraw) / 1000, 0.05) : 1 / 60
            const T = 0.5 - (p.resp.followSpeed / 10) * 0.42
            if (rm) {
                yaw.x = tYaw; pitch.x = tPitch; bodyYaw.x = faceT
                eyeX.x = tEyeX; eyeY.x = tEyeY
                yaw.v = pitch.v = bodyYaw.v = eyeX.v = eyeY.v = 0
            } else {
                stepSpring(yaw, tYaw, T, sdt)
                stepSpring(pitch, tPitch, T, sdt)
                stepSpring(bodyYaw, faceT, T * 1.7, sdt)
                stepSpring(eyeX, tEyeX, T * 0.45, sdt)
                stepSpring(eyeY, tEyeY, T * 0.45, sdt)
            }

            // Walk: ease up to speed toward the goal, slow on arrival; the
            // gait advances with distance covered, so feet never slide.
            {
                const vmax = 0.6 + p.walkSpeed * 0.25
                let left = sdt
                while (left > 0) {
                    const h = Math.min(left, 0.004)
                    const err = walkGoal - walkX
                    const vd = Math.max(-vmax, Math.min(vmax, err * 2.5))
                    walkV += (vd - walkV) * Math.min(1, h * 6)
                    walkX += walkV * h
                    gait += (Math.abs(walkV) * h * Math.PI) / STRIDE
                    const amt = Math.min(1, Math.abs(walkV) / 0.35)
                    walkAmt += (amt - walkAmt) * Math.min(1, h * 8)
                    left -= h
                }
                if (Math.abs(walkGoal - walkX) < 0.01 && Math.abs(walkV) < 0.01 && walkAmt < 0.01) {
                    walkX = walkGoal
                    walkV = 0
                    walkAmt = 0
                }
                gait %= Math.PI * 2
            }

            if (++rectCheck >= 30) {
                rectCheck = 0
                measureShown()
            }
            draw()
            dirty = false
            const interval = pace * period
            if (lastDraw && wasBusy) judge(now - lastDraw, interval, sdt)
            lastDraw = now
            wasBusy = true
        }

        if (!init()) {
            setFailed(true)
            return
        }

        const ro =
            typeof ResizeObserver !== "undefined"
                ? new ResizeObserver((entries) => {
                      const e = entries[0]
                      if (!e) return
                      layoutW = Math.max(1, e.contentRect.width)
                      layoutH = Math.max(1, e.contentRect.height)
                      measureShown()
                      needResize = true
                      wake()
                  })
                : null
        if (ro) ro.observe(host)
        layoutW = Math.max(1, host.clientWidth)
        layoutH = Math.max(1, host.clientHeight)

        const io =
            typeof IntersectionObserver !== "undefined"
                ? new IntersectionObserver(
                      (entries) => {
                          const e = entries[entries.length - 1]
                          onScreen = e.isIntersecting
                          if (onScreen) wake()
                      },
                      { rootMargin: "64px" }
                  )
                : null
        if (io) io.observe(host)

        const onVisibility = () => {
            pageVisible = document.visibilityState !== "hidden"
            if (pageVisible) wake()
        }
        document.addEventListener("visibilitychange", onVisibility)

        const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
        reduceMotion = mq.matches
        const onMQ = (ev: MediaQueryListEvent) => {
            reduceMotion = ev.matches
            wake()
        }
        mq.addEventListener("change", onMQ)

        const record = (e: PointerEvent) => {
            if (e.clientX === ptrX && e.clientY === ptrY && ptrSeen) return
            ptrX = e.clientX
            ptrY = e.clientY
            ptrSeen = true
            ptrNew = true
            if (e.pointerType === "touch") touchUntil = clock + 1.5
        }
        const onWinMove = (e: PointerEvent) => {
            ptrInPage = true
            record(e)
        }
        const onDocLeave = (e: MouseEvent) => {
            if (!e.relatedTarget) ptrInPage = false
        }
        const onBlur = () => {
            ptrInPage = false
            ptrInFrame = false
        }
        const onEnter = (e: PointerEvent) => {
            ptrInFrame = true
            record(e)
        }
        const onLeave = () => {
            ptrInFrame = false
        }
        const onDown = (e: PointerEvent) => {
            ptrInFrame = true
            ptrInPage = true
            record(e)
            if (e.pointerType === "touch") touchUntil = clock + 1.5
            const p = propsRef.current
            if (reduceMotion || p.resp.hop <= 0) return
            if (dropAt >= 0 && !dropDone) return
            const h = hopAt >= 0 ? clock - hopAt : 1e9
            if (h > HOP_CROUCH + HOP_AIR) hopAt = clock
            joyAt = clock
        }
        const onScroll = () => {
            scrolled = true
        }
        window.addEventListener("pointermove", onWinMove, { passive: true })
        document.addEventListener("mouseout", onDocLeave)
        window.addEventListener("blur", onBlur)
        window.addEventListener("scroll", onScroll, { passive: true, capture: true })
        host.addEventListener("pointerenter", onEnter)
        host.addEventListener("pointerleave", onLeave)
        host.addEventListener("pointerdown", onDown)

        const onLost = (ev: Event) => {
            ev.preventDefault()
            cancelAnimationFrame(raf)
            gl = null
            program = null
        }
        const onRestored = () => {
            if (disposed) return
            lastTick = 0
            lastDraw = 0
            if (init()) raf = requestAnimationFrame(loop)
            else setFailed(true)
        }
        canvas.addEventListener("webglcontextlost", onLost)
        canvas.addEventListener("webglcontextrestored", onRestored)

        raf = requestAnimationFrame(loop)

        return () => {
            disposed = true
            wakeRef.current = () => {}
            cancelAnimationFrame(raf)
            if (ro) ro.disconnect()
            if (io) io.disconnect()
            document.removeEventListener("visibilitychange", onVisibility)
            mq.removeEventListener("change", onMQ)
            window.removeEventListener("pointermove", onWinMove)
            document.removeEventListener("mouseout", onDocLeave)
            window.removeEventListener("blur", onBlur)
            window.removeEventListener("scroll", onScroll, { capture: true })
            host.removeEventListener("pointerenter", onEnter)
            host.removeEventListener("pointerleave", onLeave)
            host.removeEventListener("pointerdown", onDown)
            canvas.removeEventListener("webglcontextlost", onLost)
            canvas.removeEventListener("webglcontextrestored", onRestored)
            if (gl) {
                for (const q of queries) gl.deleteQuery(q.q)
                if (buffer) gl.deleteBuffer(buffer)
                if (vao) gl.deleteVertexArray(vao)
                if (program) gl.deleteProgram(program)
            }
        }
    }, [])

    // The cyc gradient in CSS too: what shows if WebGL is unavailable, and
    // under the canvas before its first frame.
    const curve = adv.gradientCurve
    const stops = [0, 0.25, 0.5, 0.75, 1]
        .map((v) => {
            const a = toRGB(bgc.top, DEFAULT_BACKGROUND.top)
            const b = toRGB(bgc.bottom, DEFAULT_BACKGROUND.bottom)
            const f = 1 - Math.pow(1 - v, curve)
            const c = a.map((x, i) => Math.round((x + (b[i] - x) * f) * 255))
            return `rgb(${c[0]},${c[1]},${c[2]}) ${v * 100}%`
        })
        .join(", ")

    return (
        <div
            ref={hostRef}
            role="img"
            aria-label="Clay, l'assistant IA de Niala"
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                aspectRatio: `${REF_W} / ${REF_H}`,
                overflow: "hidden",
                background: transparent ? "transparent" : `linear-gradient(180deg, ${stops})`,
                touchAction: "pan-y",
                cursor: resp.hop > 0 ? "pointer" : "default",
                userSelect: "none",
                WebkitTapHighlightColor: "transparent",
                ...style,
            }}
        >
            <canvas
                ref={canvasRef}
                style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    display: failed ? "none" : "block",
                }}
            />
        </div>
    )
}

/* --------------------------------------------------- property controls */
