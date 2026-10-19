import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { LogoMark } from "@/components/common/LogoMark";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { APP_NAME } from "@/lib/site";
import { UNSET_TEXT, hasMissingValues, type PrivacyValues } from "../config";
import { POLICY_EFFECTIVE_LINE, POLICY_INTRO, POLICY_SECTIONS, POLICY_TITLE, type PolicyBlock } from "../content";

// 서버 컴포넌트(앱 셸 밖 공개 화면). 운영자 정보는 props로만 받는다.

export const MISSING_VALUES_WARNING = "운영자 정보가 아직 설정되지 않았습니다. 이 처리방침은 공개 전 초안입니다.";

const PLACEHOLDERS = {
  "{운영자}": "operatorName",
  "{보호책임자}": "officerName",
  "{연락 이메일}": "contactEmail",
  "{호스팅 업체}": "hostingProvider",
  "{시행일}": "effectiveDate",
} as const satisfies Record<string, keyof PrivacyValues>;

// 13절 기관 주소. 문구는 그대로 두고 링크만 붙인다.
const AGENCY_DOMAINS = ["www.kopico.go.kr", "privacy.kisa.or.kr", "www.spo.go.kr", "ecrm.police.go.kr"];

const TOKEN_PATTERN = new RegExp(
  `(${[...Object.keys(PLACEHOLDERS), ...AGENCY_DOMAINS].map((token) => token.replace(/[.{}]/g, "\\$&")).join("|")}|https://[^\\s)]+)`,
);

const linkClass = "font-medium text-foreground underline underline-offset-4 break-all print:no-underline";

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

function Inline({ text, values }: { text: string; values: PrivacyValues }) {
  return text.split(TOKEN_PATTERN).map((part, index) => {
    if (!part) return null;
    if (part in PLACEHOLDERS) {
      const key = PLACEHOLDERS[part as keyof typeof PLACEHOLDERS];
      const value = values[key];
      if (value === null) return <Fragment key={index}>{UNSET_TEXT}</Fragment>;
      if (key === "contactEmail") {
        return (
          <a key={index} href={`mailto:${value}`} className={linkClass}>
            {value}
          </a>
        );
      }
      return <Fragment key={index}>{value}</Fragment>;
    }
    if (part.startsWith("https://")) return <ExternalLink key={index} href={part}>{part}</ExternalLink>;
    if (AGENCY_DOMAINS.includes(part)) return <ExternalLink key={index} href={`https://${part}`}>{part}</ExternalLink>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function Block({ block, label, values }: { block: PolicyBlock; label: string; values: PrivacyValues }) {
  if (block.type === "p") {
    return (
      <p>
        <Inline text={block.text} values={values} />
      </p>
    );
  }
  if (block.type === "ol" || block.type === "ul") {
    const List = block.type;
    return (
      <List className={block.type === "ol" ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}>
        {block.items.map((item) => (
          <li key={item}>
            <Inline text={item} values={values} />
          </li>
        ))}
      </List>
    );
  }
  // 좁은 화면에서는 표 영역 안에서만 가로로 스크롤한다. 키보드로도 스크롤할 수 있게 포커스를 받는다.
  return (
    <div
      role="region"
      aria-label={`${label} 표`}
      tabIndex={0}
      className="overflow-x-auto rounded-md border outline-none focus-visible:ring-3 focus-visible:ring-ring/50 print:overflow-visible"
    >
      <table className="w-full min-w-[32rem] border-collapse text-left align-top print:min-w-0">
        <thead className="bg-muted/50 print:bg-transparent">
          <tr>
            {block.head.map((cell) => (
              <th key={cell} scope="col" className="border-b px-3 py-2 font-medium first:w-[30%]">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map(([name, description]) => (
            <tr key={name} className="border-b last:border-b-0">
              <th scope="row" className="px-3 py-2 align-top font-medium">
                <Inline text={name} values={values} />
              </th>
              <td className="px-3 py-2 align-top">
                <Inline text={description} values={values} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `/privacy` 본문. 7절 문구를 그대로 쓰고 `{…}` 자리는 운영자 정보로 바꾼다. 빈 값은 "(미설정)"이다. */
export function PrivacyPolicy({ values }: { values: PrivacyValues }) {
  return (
    <div className="min-h-dvh bg-background text-foreground print:bg-white print:text-black">
      <header className="border-b print:border-b-0">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <Link href="/" className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
            <LogoMark className="size-6" />
            {APP_NAME}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        {hasMissingValues(values) && (
          <Alert className="mb-6 border-amber-500/50 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100 print:bg-transparent print:text-black">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription className="text-current">{MISSING_VALUES_WARNING}</AlertDescription>
          </Alert>
        )}
        <article aria-labelledby="privacy-title" className="space-y-8 text-sm leading-7 break-keep">
          <header className="space-y-1">
            <h1 id="privacy-title" className="text-2xl font-semibold tracking-tight">
              {POLICY_TITLE}
            </h1>
            <p className="text-muted-foreground print:text-black">
              <Inline text={POLICY_EFFECTIVE_LINE} values={values} />
            </p>
          </header>
          <p>
            <Inline text={POLICY_INTRO} values={values} />
          </p>
          {POLICY_SECTIONS.map((section, index) => (
            <section key={section.title} aria-labelledby={`privacy-section-${index + 1}`} className="space-y-3">
              <h2 id={`privacy-section-${index + 1}`} className="text-base font-semibold break-after-avoid">
                {section.title}
              </h2>
              {section.blocks.map((block, blockIndex) => (
                <Block key={blockIndex} block={block} label={section.title} values={values} />
              ))}
            </section>
          ))}
        </article>
      </main>
    </div>
  );
}
