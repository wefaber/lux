import { Link } from "react-router-dom";

interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: number | string;
  color: string;
  /** Si viene, la tarjeta lleva a esa seccion */
  to?: string;
}

const CARD_CLASS =
  "block rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xl p-4 transition-all duration-300 hover:border-primary/20 hover:bg-card/75 hover:shadow-md hover:-translate-y-[2px] sm:p-6";

export function MetricCard({ icon: Icon, label, value, color, to }: MetricCardProps) {
  const content = (
    <>
      <div
        className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl sm:mb-4 sm:h-10 sm:w-10"
        style={{ backgroundColor: `${color}12` }}
      >
        <Icon className="h-5 w-5" style={{ color }} />
      </div>
      <p className="mb-1 text-[10px] font-semibold uppercase leading-tight tracking-wider text-muted-foreground sm:text-xs sm:tracking-widest">
        {label}
      </p>
      <p className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{value}</p>
    </>
  );

  return to ? (
    <Link to={to} className={CARD_CLASS}>
      {content}
    </Link>
  ) : (
    <div className={CARD_CLASS}>{content}</div>
  );
}
