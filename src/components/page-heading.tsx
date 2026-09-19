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
    <div className="mb-5 sm:mb-7">
      <div className="page-accent-line mb-4 h-px w-16 rounded-full" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="page-kicker mb-1.5 text-[9px] font-semibold uppercase">
            Lynerva intelligence
          </p>
          <h1 className="text-[25px] font-semibold tracking-[-0.045em] sm:text-[31px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 max-w-3xl text-[12px] leading-5 text-muted sm:text-sm sm:leading-6">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
