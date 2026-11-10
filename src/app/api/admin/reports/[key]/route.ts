import { handle } from "@/lib/api-helpers";
import { audit } from "@/server/admin/audit";
import { renderCsv, renderPdf, renderXlsx } from "@/server/admin/exporters";
import { REPORTS, buildReport } from "@/server/admin/reports";
import { requireAdmin } from "@/server/admin/session";
import { resolvePeriod } from "@/server/admin/stats/common";

export const maxDuration = 120;

const FORMATS = {
  csv: { mime: "text/csv; charset=utf-8", ext: "csv" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
  pdf: { mime: "application/pdf", ext: "pdf" },
} as const;

/** Export d'un rapport sur la période demandée, dans le format choisi (csv, xlsx, pdf). */
export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin("reports.export");
    const { key } = await ctx.params;
    if (!REPORTS.some((r) => r.key === key)) return Response.json({ error: "Rapport inconnu." }, { status: 404 });
    const q = new URL(req.url).searchParams;
    const format = (q.get("format") ?? "csv") as keyof typeof FORMATS;
    if (!(format in FORMATS)) return Response.json({ error: "Format inconnu (csv, xlsx ou pdf)." }, { status: 422 });
    const period = resolvePeriod({ p: q.get("p") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
    const report = await buildReport(key, period, { module: q.get("module") });
    const body = format === "csv" ? Buffer.from(renderCsv(report), "utf8") : format === "xlsx" ? await renderXlsx(report) : await renderPdf(report);
    await audit(admin, "report.export", { targetType: "report", targetId: key, detail: { format, period: period.label } });
    const name = `niala-${key}-${period.from.toISOString().slice(0, 10)}_${period.to.toISOString().slice(0, 10)}.${FORMATS[format].ext}`;
    return new Response(new Uint8Array(body), { headers: { "Content-Type": FORMATS[format].mime, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
  });
}
