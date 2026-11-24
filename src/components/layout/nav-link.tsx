"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { useModuleHref } from "@/lib/module-memory";

/** Lien vers un module : il rouvre la dernière vue de ce module (un cours ouvert, par exemple) quand on y revient d'un autre. */
export function NavLink({ href, ...props }: ComponentProps<typeof Link>) {
  const pathname = usePathname();
  const target = useModuleHref(String(href), pathname);
  return <Link {...props} href={target} />;
}
