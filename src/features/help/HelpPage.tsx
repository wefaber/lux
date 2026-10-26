import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  ExternalLink,
  LifeBuoy,
  Mail,
  RefreshCw,
  Search,
  SearchX,
  Timer,
  X,
} from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useI18n } from "@/hooks/useI18n";
import { ROUTES, SPRING_TRANSITION } from "@/lib/constants";
import {
  HELP_CATEGORY_LABEL_KEYS,
  countHelpItems,
  filterHelpCategories,
  helpTextFor,
  isExternalHelpUrl,
  type HelpCategory,
  type HelpConfig,
  type HelpFaq,
} from "@/lib/help";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { loadHelpConfig } from "./loadHelpConfig";

interface FaqItemProps {
  item: HelpFaq;
  lang: string;
  /** Al buscar se muestran las respuestas sin tener que abrir cada pregunta. */
  openOnSearch: boolean;
}

function FaqItem({ item, lang, openOnSearch }: FaqItemProps) {
  return (
    <details
      open={openOnSearch || undefined}
      className="group border-t border-border/40 first:border-t-0"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{helpTextFor(item.question, lang)}</span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="px-4 pb-4 text-sm leading-relaxed whitespace-pre-line text-muted-foreground sm:px-5">
        {helpTextFor(item.answer, lang)}
      </div>
    </details>
  );
}

function ContactRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
    </div>
  );
}

interface ContactCardProps {
  config: HelpConfig;
  lang: string;
  mailto: string;
  guideLabel: string;
}

function ContactCard({ config, lang, mailto, guideLabel }: ContactCardProps) {
  const { t } = useI18n();
  const { email, schedule, responseTime } = config.contact;
  const guide = config.guide;

  return (
    <Card className="overflow-hidden border-primary/20 bg-primary/[0.04] hover:translate-y-0 hover:border-primary/30 hover:bg-primary/[0.05] hover:shadow-xs">
      <CardContent className="flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LifeBuoy className="h-4.5 w-4.5" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {t("help.doubt.title")}
            </h2>
          </div>
          <p className="max-w-lg text-sm text-muted-foreground">{t("help.doubt.text")}</p>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <ContactRow
              label={t("help.contact.email")}
              value={
                <a href={mailto} className="break-all font-medium text-primary hover:underline">
                  {email}
                </a>
              }
            />
            {schedule && (
              <ContactRow
                label={t("help.contact.schedule")}
                value={
                  <span className="inline-flex items-start gap-1.5">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    {helpTextFor(schedule, lang)}
                  </span>
                }
              />
            )}
            {responseTime && (
              <ContactRow
                label={t("help.contact.responseTime")}
                value={
                  <span className="inline-flex items-start gap-1.5">
                    <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    {helpTextFor(responseTime, lang)}
                  </span>
                }
              />
            )}
          </dl>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col">
          <Button asChild>
            <a href={mailto}>
              <Mail className="h-4 w-4" aria-hidden="true" />
              {t("help.contact.cta")}
            </a>
          </Button>
          {guide &&
            (isExternalHelpUrl(guide.url) ? (
              <Button asChild variant="secondary">
                <a href={guide.url} target="_blank" rel="noreferrer">
                  {guideLabel}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </Button>
            ) : (
              <Button asChild variant="secondary">
                <Link to={guide.url}>{guideLabel}</Link>
              </Button>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function HelpPage() {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");
  const { data, isLoading, error, refetch } = useAsync(loadHelpConfig, []);

  const categories = useMemo(
    () => (data ? filterHelpCategories(data.categories, query, lang) : []),
    [data, query, lang],
  );
  const searching = query.trim().length > 0;
  const matching = countHelpItems(categories);

  const categoryLabel = (category: HelpCategory): string => {
    if (category.id in HELP_CATEGORY_LABEL_KEYS) {
      return t(HELP_CATEGORY_LABEL_KEYS[category.id as keyof typeof HELP_CATEGORY_LABEL_KEYS]);
    }
    return category.label ? helpTextFor(category.label, lang) : category.id;
  };

  const mailto = data
    ? `mailto:${data.contact.email}?subject=${encodeURIComponent(t("help.mailSubject"))}`
    : "#";
  const guideLabel: string = data?.guide?.label
    ? helpTextFor(data.guide.label, lang)
    : t("help.guide");

  const searchField = (
    <Card className="p-4 hover:translate-y-0 hover:border-border/70 hover:bg-card/60 hover:shadow-xs">
      <label htmlFor="help-search" className="sr-only">
        {t("help.search.label")}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id="help-search"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
          placeholder={t("help.search.placeholder")}
          autoComplete="off"
          enterKeyHint="search"
          className="pl-10 pr-10"
        />
        {searching && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("help.search.clear")}
            title={t("help.search.clear")}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-0.5">
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {searching ? t("help.results", { count: matching }) : t("help.faq")}
        </p>
        {searching && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="cursor-pointer text-xs font-medium text-primary hover:underline"
          >
            {t("help.search.clear")}
          </button>
        )}
      </div>
    </Card>
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <LifeBuoy className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("help.title")}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("help.subtitle")}</p>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING_TRANSITION}
        className="space-y-6"
      >
        {isLoading && (
          <div className="space-y-3" aria-busy="true" aria-label={t("help.loading")}>
            <Skeleton className="h-[86px] w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        )}

        {!isLoading && error && (
          <Card className="hover:translate-y-0 hover:border-border/70 hover:bg-card/60 hover:shadow-xs">
            <CardContent className="flex flex-col items-start gap-3 p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                {t("help.error.title")}
              </h2>
              <p className="max-w-lg text-sm text-muted-foreground">{t("help.error.text")}</p>
              <details className="w-full text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none font-medium">
                  {t("help.error.detail")}
                </summary>
                <p className="mt-1 break-words font-mono text-[11px] leading-relaxed">{error}</p>
              </details>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" onClick={refetch}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("common.retry")}
                </Button>
                <Button size="sm" variant="secondary" asChild>
                  <Link to={ROUTES.DASHBOARD}>{t("errorPage.backHome")}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {!isLoading && data && (
          <>
            {searchField}

            {matching === 0 ? (
              <Card className="hover:translate-y-0 hover:border-border/70 hover:bg-card/60 hover:shadow-xs">
                <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <SearchX className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <h2 className="text-base font-semibold text-foreground">
                    {t("help.empty.title")}
                  </h2>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    {t("help.empty.text", { query: query.trim() })}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 pt-1">
                    <Button size="sm" variant="secondary" onClick={() => setQuery("")}>
                      {t("help.empty.clear")}
                    </Button>
                    <Button size="sm" asChild>
                      <a href={mailto}>
                        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("help.contact.cta")}
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {categories.map((category) => (
                  <section
                    key={category.id}
                    aria-labelledby={`help-category-${category.id}`}
                    className="space-y-2"
                  >
                    <div className="flex items-center gap-2 px-1">
                      <h2
                        id={`help-category-${category.id}`}
                        className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
                      >
                        {categoryLabel(category)}
                      </h2>
                      <Badge color="muted" className="px-2 py-0 text-[10px]">
                        {category.items.length}
                      </Badge>
                    </div>
                    <Card className="overflow-hidden hover:translate-y-0 hover:border-border/70 hover:bg-card/60 hover:shadow-xs">
                      {category.items.map((item) => (
                        <FaqItem
                          key={`${category.id}-${item.id}`}
                          item={item}
                          lang={lang}
                          openOnSearch={searching}
                        />
                      ))}
                    </Card>
                  </section>
                ))}
              </div>
            )}

            <ContactCard config={data} lang={lang} mailto={mailto} guideLabel={guideLabel} />
          </>
        )}
      </motion.div>
    </div>
  );
}
