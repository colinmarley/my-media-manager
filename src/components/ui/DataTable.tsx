'use client';

import React from 'react';
import { DataGrid, type DataGridProps, type GridValidRowModel } from '@mui/x-data-grid';
import { borders, surfaces, text } from '@/theme/tokens';
import EmptyState from './EmptyState';

export interface DataTableProps<R extends GridValidRowModel> extends DataGridProps<R> {
  /** Shown instead of the grid's default "No rows" overlay. */
  emptyTitle?: string;
  emptyDescription?: string;
}

/**
 * Thin wrapper over MUI X DataGrid with the app's density and surface
 * styling. All DataGrid props pass through.
 */
function DataTable<R extends GridValidRowModel>({
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  density = 'compact',
  slots,
  sx,
  ...rest
}: DataTableProps<R>) {
  const NoRows = React.useCallback(
    () => <EmptyState compact title={emptyTitle} description={emptyDescription} />,
    [emptyTitle, emptyDescription],
  );
  return (
    <DataGrid<R>
      density={density}
      disableRowSelectionOnClick
      slots={{ noRowsOverlay: NoRows, ...slots }}
      sx={[
        {
          border: `1px solid ${borders.default}`,
          bgcolor: surfaces.paper,
          '--DataGrid-containerBackground': surfaces.chrome,
          '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600, color: text.secondary },
          '& .MuiDataGrid-cell': { borderColor: borders.subtle },
          '& .MuiDataGrid-row:hover': { bgcolor: surfaces.raised },
          '& .MuiDataGrid-cell:focus, & .MuiDataGrid-columnHeader:focus': { outline: 'none' },
          '& .MuiDataGrid-cell:focus-visible, & .MuiDataGrid-columnHeader:focus-visible': {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: -2,
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
    />
  );
}

export default DataTable;
