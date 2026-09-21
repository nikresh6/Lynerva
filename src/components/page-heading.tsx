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
    <div className="mb-6 sm:mb-9">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="page-kicker mb-2 text-[9px] font-semibold uppercase">
            Huddlemark board
          </p>
          <h1 className="max-w-4xl text-[30px] font-semibold leading-tight tracking-[-0.05em] sm:text-[42px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 max-w-3xl text-[13px] leading-6 text-muted sm:text-[15px] sm:leading-7">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
