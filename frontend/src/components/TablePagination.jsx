import { useEffect, useId, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function TablePagination({
  page,
  pageCount,
  totalItems,
  pageSize = 10,
  itemLabel,
  onPageChange,
  className = "",
}) {
  const inputId = useId();
  const [pageInput, setPageInput] = useState(String(page));
  const lastPage = Math.max(1, pageCount || 1);
  const itemCount = Number(totalItems) || 0;
  const firstItem = itemCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, itemCount);
  const formattedTotal = itemCount.toLocaleString("en-US");

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  const goToPage = () => {
    const requestedPage = Number.parseInt(pageInput, 10);
    if (!Number.isInteger(requestedPage)) {
      setPageInput(String(page));
      return;
    }
    onPageChange(Math.min(Math.max(requestedPage, 1), lastPage));
  };

  return (
    <div className={`pager${className ? ` ${className}` : ""}`}>
      <div className="pagerInfo">
        <span className="pagerRange">
          Showing <strong>{firstItem.toLocaleString("en-US")}–{lastItem.toLocaleString("en-US")}</strong>{" "}
          of <strong>{formattedTotal}</strong>{" "}
          {`${itemLabel}${itemCount === 1 ? "" : "s"}`}
        </span>
        <span className="pagerPageSummary">
          Page <strong>{page}</strong> of <strong>{lastPage}</strong>
        </span>
      </div>
      <div className="pagerControls">
        <button
          className="pagerArrow"
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          title="Previous page"
          aria-label="Previous page"
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <div className="pageJump" aria-label="Jump to page">
          <label htmlFor={inputId}>Go to page</label>
          <input
            type="text"
            inputMode="numeric"
            id={inputId}
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") goToPage();
            }}
            aria-label="Page number"
          />
          <button type="button" onClick={goToPage}>Go</button>
        </div>
        <button
          type="button"
          className="pagerArrow"
          disabled={page >= lastPage}
          onClick={() => onPageChange(Math.min(lastPage, page + 1))}
          title="Next page"
          aria-label="Next page"
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
