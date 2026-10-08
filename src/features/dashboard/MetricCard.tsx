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
  "block rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xl p-6 transition-all duration-300 hover:border-primary/20 hover:bg-card/75 hover:shadow-md hover:-translate-y-[2px]";

export function MetricCard({ icon: Icon, label, value, color, to }: MetricCardProps) {
  const content = (
    <>
      <div
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl mb-4"
        style={{ backgroundColor: `${color}12` }}
      >
        <Icon className="h-5 w-5" style={{ color }} />
      </div>
      <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-1">
        {label}
      </p>
      <p className="text-3xl font-bold tracking-tight text-foreground">{value}</p>
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
