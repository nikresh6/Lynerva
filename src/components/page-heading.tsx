export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 sm:mb-7">
      <div className="page-accent-line mb-2.5 h-px w-12 rounded-full sm:mb-4 sm:w-16" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="page-kicker mb-1 text-[8px] font-semibold uppercase sm:mb-1.5 sm:text-[9px]">
            Lynerva intelligence
          </p>
          <h1 className="text-[23px] font-semibold tracking-[-0.045em] sm:text-[31px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-3xl line-clamp-2 text-[11px] leading-[1.55] text-muted sm:mt-1.5 sm:line-clamp-none sm:text-sm sm:leading-6">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
