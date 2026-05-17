import {
  type Column,
  type FilterFn,
  flexRender,
  functionalUpdate,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
  SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import { columns } from "./columns";
import {
  getEmployees,
  setEmployees,
  updateEmployee,
} from "../../../redux/Employee/index.slice";
import { useUnsavedChangesWarning } from "../../../hooks/useUnsavedChangesWarning";
import type { Employee } from "../../../types/employee";
import { exportRowsToCsv } from "../../../utils/csvExport";

const gridTemplate =
  "180px 250px 180px 220px 140px 140px 140px 180px 180px";
type EditableEmployee = Partial<Employee>;
type SalaryFilterValue = {
  min?: string;
  max?: string;
};

const FILTERABLE_COLUMN_IDS = new Set([
  "employeeName",
  "email",
  "department",
  "role",
  "salary",
  "licensesUsed",
  "status",
  "joinDate",
]);
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250];
const ACTION_COLUMN_ID = "actions";
const tableMinWidth = "1610px";
const numberFormatter = new Intl.NumberFormat("en-US");
const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});

const getVisiblePageNumbers = (
  currentPageIndex: number,
  pageCount: number
) => {
  const currentPage = currentPageIndex + 1;
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(pageCount, currentPage + 2);

  return Array.from(
    { length: end - start + 1 },
    (_, index) => start + index
  );
};

const FilterIcon = ({ active }: { active: boolean }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className={`h-4 w-4 ${active ? "text-black" : "text-gray-500"}`}
    fill="currentColor"
  >
    <path d="M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 .78 1.63L14 14.1V19a1 1 0 0 1-.45.83l-3 2A1 1 0 0 1 9 21v-6.9L3.22 5.63A1 1 0 0 1 3 5Z" />
  </svg>
);

const SortIcon = ({ active, direction }: { active: boolean; direction: "up" | "down" }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 10 6"
    className={`h-2.5 w-2.5 ${active ? "text-black" : "text-gray-300"}`}
    fill="currentColor"
  >
    {direction === "up" ? (
      <path d="M5 0 10 6H0L5 0Z" />
    ) : (
      <path d="M5 6 0 0h10L5 6Z" />
    )}
  </svg>
);

const ExportIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
  >
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);

const SearchIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

const formatDateForCsv = (value: unknown) => {
  const date = new Date(String(value));

  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
};

const filterPlaceholders: Record<string, string> = {
  email: "Filter by email...",
  employeeName: "Search employee name...",
  joinDate: "Select join date...",
  licensesUsed: "Filter licenses used...",
  role: "Filter by role...",
};

const hasEmployeeChanges = (
  originalEmployee: Employee | null,
  editedEmployee: EditableEmployee
) => {
  if (!originalEmployee) return false;

  return (Object.keys(editedEmployee) as Array<keyof Employee>).some(
    (field) => editedEmployee[field] !== originalEmployee[field]
  );
};

const globalSearchFields: Array<keyof Employee> = [
  "employeeName",
  "email",
  "department",
  "role",
  "salary",
  "licensesUsed",
  "status",
  "joinDate",
];

const employeeGlobalFilter: FilterFn<Employee> = (
  row,
  _columnId,
  filterValue
) => {
  const searchValue = String(filterValue ?? "").trim().toLowerCase();

  if (!searchValue) return true;

  return globalSearchFields.some((field) =>
    String(row.original[field]).toLowerCase().includes(searchValue)
  );
};

const EmployeeTable = () => {
  const dispatch = useDispatch();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] =
    useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });
  const [openFilterColumnId, setOpenFilterColumnId] =
    useState<string | null>(null);
  const [editingRowId, setEditingRowId] =
    useState<number | null>(null);
  const [, setEditingField] = useState<string | null>(null);

  const [editedData, setEditedData] =
    useState<EditableEmployee>({});
  const editedDataRef = useRef<EditableEmployee>(editedData);

  const [originalRowData, setOriginalRowData] =
    useState<Employee | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  useUnsavedChangesWarning(hasUnsavedChanges);

  // Track per-row last saved state so Undo is available only after a save.
  const [savedHistory, setSavedHistory] =
    useState<Record<number, Employee>>({});
  const employees = useSelector(getEmployees);
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;

    const loadEmployees = async () => {
      const { generateEmployees } = await import("../../../data/generateEmployees");

      if (!isMounted) return;

      dispatch(setEmployees(generateEmployees(10000)));
      setIsInitialLoading(false);
    };

    void loadEmployees();

    return () => {
      isMounted = false;
    };
  }, [dispatch]);

  const departmentOptions = useMemo(
    () =>
      Array.from(
        new Set(
          employees.map((employee) => employee.department)
        )
      ).sort(),
    [employees]
  );
  const summaryCards = useMemo(() => {
    const totalEmployees = employees.length;
    const activeEmployees = employees.filter(
      (employee) => employee.status === "Active"
    ).length;
    const inactiveEmployees = totalEmployees - activeEmployees;
    const averageSalary =
      totalEmployees === 0
        ? 0
        : employees.reduce(
          (sum, employee) => sum + employee.salary,
          0
        ) / totalEmployees;

    return [
      {
        label: "Total Employees",
        value: numberFormatter.format(totalEmployees),
      },
      {
        label: "Active Employees",
        value: numberFormatter.format(activeEmployees),
      },
      {
        label: "Inactive Employees",
        value: numberFormatter.format(inactiveEmployees),
      },
      {
        label: "Average Salary",
        value: currencyFormatter.format(averageSalary),
      },
    ];
  }, [employees]);

  const handleEdit = useCallback((row: Employee) => {
    setEditingRowId(row.id);
    setHasUnsavedChanges(false);

    setEditedData(row);
    editedDataRef.current = row;

    setOriginalRowData(row);
  }, []);

  const handleInputChange = useCallback((
    field: keyof Employee,
    value: string | number
  ) => {
    setEditedData((prev) => {
      const next = { ...prev, [field]: value };
      editedDataRef.current = next;
      setHasUnsavedChanges(hasEmployeeChanges(originalRowData, next));
      return next;
    });
  }, [originalRowData]);

  const handleSave = useCallback((id: number) => {
    const prevEmployee = employees.find(
      (employee) => employee.id === id
    );

    if (prevEmployee) {
      setSavedHistory((prev) => ({ ...prev, [id]: prevEmployee }));
    }

    dispatch(updateEmployee({
      id,
      updatedData: editedDataRef.current,
    }));

    setEditingRowId(null);
    setEditingField(null);
    setHasUnsavedChanges(false);
  }, [dispatch, employees]);

  const handleCancel = useCallback(() => {
    if (originalRowData) {
      setEditedData(originalRowData);
      editedDataRef.current = originalRowData;
    }

    setEditingRowId(null);
    setEditingField(null);
    setHasUnsavedChanges(false);
  }, [originalRowData]);

  const handleUndo = useCallback((id: number) => {
    const lastSaved = savedHistory[id];

    if (!lastSaved) return;

    dispatch(updateEmployee({
      id,
      updatedData: lastSaved,
    }));

    setSavedHistory((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }, [dispatch, savedHistory]);

  const resetPaginationForFiltering = useCallback(() => {
    setPagination((current) =>
      current.pageIndex === 0
        ? current
        : { ...current, pageIndex: 0 }
    );
    parentRef.current?.scrollTo({ top: 0 });
  }, []);

  const handleColumnFiltersChange =
    useCallback<OnChangeFn<ColumnFiltersState>>((updater) => {
      setColumnFilters((current) => functionalUpdate(updater, current));
      resetPaginationForFiltering();
    }, [resetPaginationForFiltering]);

  const handleGlobalFilterChange =
    useCallback<OnChangeFn<string>>((updater) => {
      setGlobalFilter((current) => functionalUpdate(updater, current));
      resetPaginationForFiltering();
    }, [resetPaginationForFiltering]);

  const memoizedColumns = useMemo(
    () =>
      columns(
        editingRowId,
        editedDataRef,
        handleInputChange,
        handleEdit,
        handleSave,
        handleCancel,
        handleUndo,
        setEditingField,
        savedHistory
      ),
    [
      editingRowId,
      handleCancel,
      handleEdit,
      handleInputChange,
      handleSave,
      handleUndo,
      savedHistory,
    ]
  );
  const table = useReactTable({
    data: employees,
    columns: memoizedColumns,
    state: {
      sorting,
      globalFilter,
      columnFilters,
      pagination,
    },

    onSortingChange: setSorting,
    onGlobalFilterChange: handleGlobalFilterChange,
    onColumnFiltersChange: handleColumnFiltersChange,
    onPaginationChange: setPagination,

    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: employeeGlobalFilter,
    autoResetPageIndex: false,
  });

  const handleExportCsv = useCallback(() => {
    const exportRows = table.getSortedRowModel().rows;
    const exportColumns = table
      .getVisibleLeafColumns()
      .filter((column) => column.id !== ACTION_COLUMN_ID);

    exportRowsToCsv<Employee>({
      columns: exportColumns,
      filename: "employees-export.csv",
      rows: exportRows,
      formatters: {
        joinDate: ({ value }) => formatDateForCsv(value),
      },
    });
  }, [table]);

  const updateSalaryFilter = (
    column: Column<Employee, unknown>,
    min: string,
    max: string
  ) => {
    const nextMin = min.trim();
    const nextMax = max.trim();

    column.setFilterValue(
      nextMin || nextMax ? { min: nextMin, max: nextMax } : undefined
    );
  };

  const renderColumnFilter = (column: Column<Employee, unknown>) => {
    const columnId = column.id;
    const filterValue = column.getFilterValue();
    const inputClasses =
      "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200";

    if (columnId === "department") {
      return (
        <select
          value={(filterValue as string | undefined) ?? ""}
          onChange={(event) =>
            column.setFilterValue(event.target.value || undefined)
          }
          className={inputClasses}
        >
          <option value="">Filter by department...</option>
          {departmentOptions.map((department) => (
            <option key={department} value={department}>
              {department}
            </option>
          ))}
        </select>
      );
    }

    if (columnId === "status") {
      return (
        <select
          value={(filterValue as string | undefined) ?? ""}
          onChange={(event) =>
            column.setFilterValue(event.target.value || undefined)
          }
          className={inputClasses}
        >
          <option value="">Filter by status...</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
      );
    }

    if (columnId === "salary") {
      const salaryFilter = (filterValue ?? {}) as SalaryFilterValue;

      return (
        <div className="grid gap-2">
          <input
            type="number"
            min="0"
            placeholder="Minimum salary..."
            value={salaryFilter.min ?? ""}
            onChange={(event) =>
              updateSalaryFilter(
                column,
                event.target.value,
                salaryFilter.max ?? ""
              )
            }
            className={inputClasses}
          />
          <input
            type="number"
            min="0"
            placeholder="Maximum salary..."
            value={salaryFilter.max ?? ""}
            onChange={(event) =>
              updateSalaryFilter(
                column,
                salaryFilter.min ?? "",
                event.target.value
              )
            }
            className={inputClasses}
          />
        </div>
      );
    }

    if (columnId === "joinDate") {
      return (
        <input
          type="date"
          aria-label="Select join date"
          value={(filterValue as string | undefined) ?? ""}
          onChange={(event) =>
            column.setFilterValue(event.target.value || undefined)
          }
          className={inputClasses}
        />
      );
    }

    return (
      <input
        type={columnId === "licensesUsed" ? "number" : "text"}
        min={columnId === "licensesUsed" ? "0" : undefined}
        placeholder={filterPlaceholders[columnId] ?? "Search records..."}
        value={(filterValue as string | number | undefined) ?? ""}
        onChange={(event) =>
          column.setFilterValue(event.target.value || undefined)
        }
        className={inputClasses}
      />
    );
  };

  const rows = table.getRowModel().rows;
  const filteredRowCount = table.getFilteredRowModel().rows.length;
  const totalRowCount = table.getCoreRowModel().rows.length;
  const pageCount = table.getPageCount();
  const pageNumbers = getVisiblePageNumbers(
    table.getState().pagination.pageIndex,
    pageCount
  );
  const pageStart =
    filteredRowCount === 0
      ? 0
      : table.getState().pagination.pageIndex *
        table.getState().pagination.pageSize +
        1;
  const pageEnd = Math.min(
    pageStart + rows.length - 1,
    filteredRowCount
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
  });

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-6">
      <div className="mx-auto max-w-[1800px] space-y-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">
              Employee Directory
            </h1>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div
              key={card.label}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="text-sm font-medium text-slate-500">
                {card.label}
              </p>
              {isInitialLoading ? (
                <div className="mt-3 h-7 w-28 animate-pulse rounded bg-slate-200" />
              ) : (
                <p className="mt-2 text-2xl font-semibold text-slate-950">
                  {card.value}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
            <div>
              <p className="text-sm font-semibold text-slate-950">
                Employee records
              </p>
              <p className="text-sm text-slate-500">
                {numberFormatter.format(filteredRowCount)} export-ready records
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="relative block">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <SearchIcon />
                </span>
                <input
                  type="search"
                  value={globalFilter}
                  onChange={(event) =>
                    table.setGlobalFilter(event.target.value)
                  }
                  placeholder="Search employees..."
                  className="h-10 w-64 rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </label>

              <button
                type="button"
                onClick={handleExportCsv}
                disabled={filteredRowCount === 0 || isInitialLoading}
                className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <ExportIcon />
                Export CSV
              </button>
            </div>
          </div>

          <div
            ref={parentRef}
            className="max-h-[640px] overflow-auto"
          >
            <div style={{ minWidth: tableMinWidth }}>
              {/* Header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: gridTemplate,
                }}
                className="sticky top-0 z-30 border-b border-slate-200 bg-slate-50 shadow-sm"
              >
                {table.getHeaderGroups().map((headerGroup) =>
                  headerGroup.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    const hasFilter = FILTERABLE_COLUMN_IDS.has(header.column.id);
                    const filterOpen = openFilterColumnId === header.column.id;
                    const filterActive =
                      header.column.getFilterValue() !== undefined;
                    const alignFilterMenuLeft =
                      header.column.id === "employeeName";

                    return (
                      <div
                        key={header.id}
                        className="relative flex min-w-0 items-center gap-2 bg-slate-50 px-4 py-4 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                      >
                        {header.column.getCanSort() ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                          >
                            <span className="truncate">
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                            </span>

                            <span className="flex flex-col leading-none">
                              <SortIcon active={sorted === "asc"} direction="up" />
                              <span className="mt-0.5">
                                <SortIcon active={sorted === "desc"} direction="down" />
                              </span>
                            </span>
                          </button>
                        ) : (
                          <span className="min-w-0 flex-1 truncate">
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                          </span>
                        )}

                        {hasFilter && (
                          <>
                            <button
                              type="button"
                              title="Filter column"
                              aria-label={`Filter ${header.column.id}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpenFilterColumnId((current) =>
                                  current === header.column.id
                                    ? null
                                    : header.column.id
                                );
                              }}
                              className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition hover:bg-white hover:shadow-sm ${filterActive
                                ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                                : "text-slate-500"
                                }`}
                            >
                              <FilterIcon active={filterActive} />
                            </button>

                            {filterOpen && (
                              <div
                                onClick={(event) => event.stopPropagation()}
                                className={`absolute top-12 z-50 w-56 rounded-lg border border-slate-200 bg-white p-3 shadow-lg ${alignFilterMenuLeft
                                  ? "left-4"
                                  : "right-2"
                                  }`}
                              >
                                {renderColumnFilter(header.column)}

                                <button
                                  type="button"
                                  onClick={() => {
                                    header.column.setFilterValue(undefined);
                                    setOpenFilterColumnId(null);
                                  }}
                                  className="mt-3 h-9 w-full cursor-pointer rounded-md bg-slate-950 px-3 text-sm font-medium text-white transition hover:bg-slate-800"
                                >
                                  Clear
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {isInitialLoading ? (
                <div className="p-4">
                  {Array.from({ length: 8 }, (_, index) => (
                    <div
                      key={index}
                      className="mb-3 grid animate-pulse items-center gap-4 rounded-md border border-slate-100 bg-white p-4"
                      style={{ gridTemplateColumns: gridTemplate }}
                    >
                      {Array.from({ length: 9 }, (_, cellIndex) => (
                        <div
                          key={cellIndex}
                          className="h-4 rounded bg-slate-200"
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <div
                  className="flex h-full min-h-[360px] flex-col items-center justify-center px-6 text-center"
                >
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-500">
                    <FilterIcon active={false} />
                  </div>
                  <h2 className="mt-4 text-base font-semibold text-slate-950">
                    No matching employees
                  </h2>
                  <p className="mt-1 max-w-md text-sm text-slate-500">
                    Adjust or clear the active column filters to bring records back into view.
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    position: "relative",
                  }}
                >
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const row = rows[virtualRow.index];
                    const isEditing = editingRowId === row.original.id;

                    return (
                      <div
                        key={row.id}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start}px)`,
                          display: "grid",
                          gridTemplateColumns: gridTemplate,
                        }}
                        className={`items-center border-b border-slate-100 transition-colors ${virtualRow.index % 2 === 0
                          ? "bg-white"
                          : "bg-slate-50/60"
                          } ${isEditing
                            ? "bg-blue-50 ring-1 ring-inset ring-blue-200"
                            : "hover:bg-slate-100/80"
                          }`}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <div
                            key={cell.id}
                            className="min-w-0 px-4 py-4 text-sm text-slate-700"
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                Showing {pageStart}-{pageEnd} of {numberFormatter.format(filteredRowCount)}
                {filteredRowCount !== totalRowCount
                  ? ` filtered from ${numberFormatter.format(totalRowCount)}`
                  : ""}{" "}
                records
              </span>

              <label className="flex items-center gap-2">
                <span>Rows per page</span>
                <select
                  value={table.getState().pagination.pageSize}
                  onChange={(event) => {
                    table.setPageSize(Number(event.target.value));
                  }}
                  className="h-9 cursor-pointer rounded-md border border-slate-300 bg-white px-2 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                >
                  {PAGE_SIZE_OPTIONS.map((pageSize) => (
                    <option key={pageSize} value={pageSize}>
                      {pageSize}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 font-medium transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>

              {pageNumbers.map((pageNumber) => {
                const active =
                  pageNumber === table.getState().pagination.pageIndex + 1;

                return (
                  <button
                    key={pageNumber}
                    type="button"
                    onClick={() => table.setPageIndex(pageNumber - 1)}
                    className={`h-9 min-w-9 cursor-pointer rounded-md border px-2 font-medium transition ${active
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                  >
                    {pageNumber}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 font-medium transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeTable;
