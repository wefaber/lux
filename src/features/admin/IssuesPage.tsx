import { useState } from "react";
import { motion } from "motion/react";
import { Bug, Copy, ExternalLink, Eye, Github, Search } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useI18n } from "@/hooks/useI18n";
import { errorMessage, formatDateTime, gql } from "@/lib/utils";
import { ERROR_REPORT_STATUS_CONFIG, SPRING_TRANSITION } from "@/lib/constants";
import type {
  ErrorReport,
  ErrorReportSettings,
  ErrorReportStatus,
  GithubIssueResult,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorAlert } from "@/components/ui/error-alert";
import { OptionSelect } from "@/components/ui/option-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";

const LIST_QUERY = `
 query GetErrorReports($status: String) {
  errorReports(status: $status) {
   id fingerprint message route occurrences lastSeen status githubIssueUrl
  }
 }
`;

const DETAIL_QUERY = `
 query GetErrorReport($id: ID!) {
  errorReport(id: $id) {
   id fingerprint message stack route userAgent role firstSeen lastSeen
   occurrences status githubIssueUrl createdAt updatedAt
  }
 }
`;

const SETTINGS_QUERY = `
 query GetErrorReportSettings {
  errorReportSettings { githubConfigured llmConfigured repository }
 }
`;

const DRAFT_QUERY = `
 query GetGithubIssueDraft($id: ID!) {
  githubIssueDraft(id: $id)
 }
`;

const UPDATE_STATUS_MUTATION = `
 mutation UpdateErrorReportStatus($id: ID!, $status: String!) {
  updateErrorReportStatus(id: $id, status: $status) { id status updatedAt }
 }
`;

const CREATE_ISSUE_MUTATION = `
 mutation CreateGithubIssue($id: ID!) {
  createGithubIssue(id: $id) { url usedLlm alreadyExisted }
 }
`;

const TH =
  "px-4 py-3 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground";

function ReportStatusBadge({ status }: { status: ErrorReportStatus }) {
  const config = ERROR_REPORT_STATUS_CONFIG[status];
  return (
    <Badge color={config.color} className="text-[10px]">
      {config.label}
    </Badge>
  );
}

interface DetailProps {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}

function IssueDetail({ id, onClose, onChanged }: DetailProps) {
  const { t } = useI18n();
  const detail = useAsync<{ errorReport: ErrorReport }>(() => gql(DETAIL_QUERY, { id }), [id]);
  const settings = useAsync<{ errorReportSettings: ErrorReportSettings }>(
    () => gql(SETTINGS_QUERY),
    [],
  );
  const draft = useAsync<{ githubIssueDraft: string }>(() => gql(DRAFT_QUERY, { id }), [id]);

  const [actionError, setActionError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  const report = detail.data?.errorReport;
  const config = settings.data?.errorReportSettings;
  const draftText = draft.data?.githubIssueDraft ?? "";

  const changeStatus = async (status: ErrorReportStatus) => {
    if (!report) return;
    setActionError("");
    try {
      await gql(UPDATE_STATUS_MUTATION, { id: report.id, status });
      detail.refetch();
      onChanged();
    } catch (err) {
      setActionError(errorMessage(err, t("admin.issues.status.updateFailed", { error: "" })));
    }
  };

  const createIssue = async () => {
    if (!report) return;
    setActionError("");
    setCreating(true);
    try {
      const data = await gql<{ createGithubIssue: GithubIssueResult }>(CREATE_ISSUE_MUTATION, {
        id: report.id,
      });
      setCreatedUrl(data.createGithubIssue.url);
      detail.refetch();
      onChanged();
    } catch (err) {
      setActionError(errorMessage(err, t("admin.issues.github.createFailed", { error: "" })));
    } finally {
      setCreating(false);
    }
  };

  const copyDraft = async () => {
    setCopyError("");
    // La Clipboard API puede faltar fuera de HTTPS: se usa el textarea temporal
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(draftText);
      } else {
        const area = document.createElement("textarea");
        area.value = draftText;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand("copy");
        area.remove();
        if (!ok) throw new Error("copy");
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyError(t("admin.issues.github.copyFailed"));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 pr-8">
            <Bug className="h-4 w-4 mt-1 shrink-0 text-destructive" />
            <span className="break-words">{report?.message ?? t("admin.issues.detail.title")}</span>
          </DialogTitle>
          <DialogDescription>{t("admin.issues.detail.title")}</DialogDescription>
        </DialogHeader>

        {detail.error && (
          <ErrorAlert>{t("admin.issues.loadFailed", { error: detail.error })}</ErrorAlert>
        )}
        {detail.isLoading && !report && <TableSkeleton rows={4} cols={2} />}

        {report && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <ReportStatusBadge status={report.status} />
              {report.githubIssueUrl || createdUrl ? (
                <Button asChild variant="secondary" size="sm">
                  <a
                    href={report.githubIssueUrl ?? createdUrl ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("admin.issues.github.openIssue")}
                  </a>
                </Button>
              ) : null}
              {report.status !== "triaged" && report.status !== "resolved" && (
                <Button size="sm" variant="secondary" onClick={() => changeStatus("triaged")}>
                  {t("admin.issues.action.triage")}
                </Button>
              )}
              {report.status !== "resolved" ? (
                <Button size="sm" variant="success" onClick={() => changeStatus("resolved")}>
                  {t("admin.issues.action.resolve")}
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => changeStatus("new")}>
                  {t("admin.issues.action.reopen")}
                </Button>
              )}
            </div>

            <ErrorAlert>{actionError}</ErrorAlert>

            <section aria-label={t("admin.issues.detail.context")} className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {t("admin.issues.detail.context")}
              </h3>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div className="flex flex-col">
                  <dt className="text-xs text-muted-foreground">
                    {t("admin.issues.detail.route")}
                  </dt>
                  <dd className="font-mono text-xs break-all">{report.route}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-xs text-muted-foreground">
                    {t("admin.issues.detail.fingerprint")}
                  </dt>
                  <dd className="font-mono text-xs break-all">{report.fingerprint}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-xs text-muted-foreground">
                    {t("admin.issues.detail.role")}
                  </dt>
                  <dd>{report.role ?? "—"}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-xs text-muted-foreground">
                    {t("admin.issues.detail.occurrences")}
                  </dt>
                  <dd>{report.occurrences}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-xs text-muted-foreground">
                    {t("admin.issues.detail.firstSeen")}
                  </dt>
                  <dd>{formatDateTime(report.firstSeen)}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-xs text-muted-foreground">
                    {t("admin.issues.detail.lastSeen")}
                  </dt>
                  <dd>{formatDateTime(report.lastSeen)}</dd>
                </div>
                <div className="flex flex-col sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">
                    {t("admin.issues.detail.browser")}
                  </dt>
                  <dd className="text-xs break-words">{report.userAgent ?? "—"}</dd>
                </div>
              </dl>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {t("admin.issues.detail.stack")}
              </h3>
              <pre className="rounded-xl border border-border bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-56 overflow-y-auto">
                {report.stack ?? t("admin.issues.detail.noStack")}
              </pre>
            </section>

            <section className="space-y-2 rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Github className="h-4 w-4" />
                    {t("admin.issues.github.title")}
                  </h3>
                  {config?.githubConfigured ? (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("admin.issues.github.configured", { repo: config.repository ?? "—" })}
                    </p>
                  ) : (
                    <>
                      <p className="text-xs font-medium text-warning mt-0.5">
                        {t("admin.issues.github.notConfigured")}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
                        {t("admin.issues.github.notConfiguredHelp")}
                      </p>
                    </>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {config?.llmConfigured
                      ? t("admin.issues.github.llmOn")
                      : t("admin.issues.github.llmOff")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={copyDraft}
                    disabled={!draftText}
                    aria-live="polite"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copied ? t("admin.issues.github.copied") : t("admin.issues.github.copyDraft")}
                  </Button>
                  {config?.githubConfigured && !report.githubIssueUrl && !createdUrl && (
                    <Button size="sm" onClick={createIssue} disabled={creating}>
                      <Github className="h-3.5 w-3.5" />
                      {creating
                        ? t("admin.issues.github.creating")
                        : t("admin.issues.github.create")}
                    </Button>
                  )}
                </div>
              </div>

              <ErrorAlert>{copyError}</ErrorAlert>
              {draft.error && (
                <ErrorAlert>
                  {t("admin.issues.github.loadFailed", { error: draft.error })}
                </ErrorAlert>
              )}
              {draft.isLoading && !draftText ? (
                <p className="text-xs text-muted-foreground">
                  {t("admin.issues.github.loadingDraft")}
                </p>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("admin.issues.github.draft")}
                  </p>
                  <pre
                    aria-label={t("admin.issues.github.draft")}
                    className="rounded-xl border border-border bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-64 overflow-y-auto"
                  >
                    {draftText}
                  </pre>
                </div>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function IssuesPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<ErrorReportStatus | "">("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const { data, isLoading, error } = useAsync<{ errorReports: ErrorReport[] }>(
    () => gql(LIST_QUERY, { status: status || null }),
    [status, reloadKey],
  );

  const needle = search.trim().toLowerCase();
  const reports = (data?.errorReports ?? []).filter(
    (r) =>
      !needle ||
      r.message.toLowerCase().includes(needle) ||
      r.route.toLowerCase().includes(needle) ||
      r.fingerprint.toLowerCase().includes(needle),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("admin.issues.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("admin.issues.subtitle")}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("admin.issues.search")}
            aria-label={t("admin.issues.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <OptionSelect
          value={status}
          onValueChange={(value) => setStatus(value as ErrorReportStatus | "")}
          aria-label={t("admin.issues.filterStatus")}
          options={[
            { value: "", label: t("common.allStatuses") },
            ...(["new", "triaged", "resolved"] as const).map((value) => ({
              value,
              label: ERROR_REPORT_STATUS_CONFIG[value].label,
            })),
          ]}
        />
      </div>

      {error && <ErrorAlert>{t("admin.issues.loadFailed", { error })}</ErrorAlert>}

      {isLoading && !data ? (
        <TableSkeleton rows={6} cols={7} />
      ) : (
        <div className="rounded-2xl border border-border overflow-x-auto bg-card/20 backdrop-blur-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className={TH}>{t("admin.issues.col.fingerprint")}</th>
                <th className={TH}>{t("admin.issues.col.message")}</th>
                <th className={TH}>{t("admin.issues.col.occurrences")}</th>
                <th className={TH}>{t("admin.issues.col.lastSeen")}</th>
                <th className={TH}>{t("admin.issues.col.status")}</th>
                <th className={TH}>
                  <span className="sr-only">{t("admin.issues.open")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {t("admin.issues.empty")}
                  </td>
                </tr>
              )}
              {reports.map((report, index) => (
                <motion.tr
                  key={report.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ ...SPRING_TRANSITION, delay: index * 0.01 }}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                    <span title={report.fingerprint}>{report.fingerprint.slice(0, 12)}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground max-w-md">
                    <span className="line-clamp-2 break-words">{report.message}</span>
                    <span className="mt-0.5 block text-xs font-mono text-muted-foreground break-all">
                      {report.route}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                    {report.occurrences}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {formatDateTime(report.lastSeen)}
                  </td>
                  <td className="px-4 py-3">
                    <ReportStatusBadge status={report.status} />
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelected(report.id)}
                      aria-label={`${t("admin.issues.open")}: ${report.message}`}
                      title={t("admin.issues.open")}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span className="sr-only">{t("admin.issues.open")}</span>
                    </Button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <IssueDetail
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={() => setReloadKey((n) => n + 1)}
        />
      )}
    </div>
  );
}
