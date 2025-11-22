"use client";

import React, { useEffect, useState } from 'react';
import { Box, Typography, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';

const CSV_PATH = '/Gridiron Slug Fantasy Board - Top 300.csv';
const EXPECTED_HEADERS = ["Rank", "Player", "POS", "Bye", "Team"];
const SELECTION_ORDER_FIELD = 'Selection Order';
const SELECTED_TEAM_FIELD = 'Selected Team';

const DraftBoardPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [columns, setColumns] = useState<GridColDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [posFilter, setPosFilter] = useState<string>('');
  const [allPos, setAllPos] = useState<string[]>([]);
  const [playerSearch, setPlayerSearch] = useState('');
  // Custom selection state: { [rowId]: 'red' | 'green' }
  const [selectedRows, setSelectedRows] = useState<{ [key: number]: 'red' | 'green' }>({});
  const [selectionOrder, setSelectionOrder] = useState<{ [key: number]: number }>({});
  const [orderEditId, setOrderEditId] = useState<number | null>(null);
  const [orderEditValue, setOrderEditValue] = useState<string>('');
  const [selectedTeams, setSelectedTeams] = useState<{ [key: number]: string }>({});
  const [teamEditId, setTeamEditId] = useState<number | null>(null);
  const [teamEditValue, setTeamEditValue] = useState<string>('');

  useEffect(() => {
    fetch(CSV_PATH)
      .then((response) => response.text())
      .then((csvText) => {
        const cleanedText = csvText.replace(/\uFEFF/, "");
        const lines = cleanedText.split('\n').filter(Boolean);
        // Find the header line
        let headerIdx = lines.findIndex(line => line.startsWith(EXPECTED_HEADERS.join(',')));
        if (headerIdx === -1) headerIdx = 0;
        setColumns(
          EXPECTED_HEADERS.map((header) => ({
            field: header,
            headerName: header,
            width: 150,
          }))
        );
        const parsedRows = lines.slice(headerIdx + 1)
          .map((line, idx) => {
            const values = line.split(',');
            // Only include rows with a numeric Rank and correct number of columns
            if (values.length === EXPECTED_HEADERS.length && /^\d+$/.test(values[0].trim())) {
              const row: any = { id: idx };
              EXPECTED_HEADERS.forEach((header, i) => {
                row[header] = values[i]?.trim() || '';
              });
              return row;
            }
            return null;
          })
          .filter(Boolean);
        setRows(parsedRows);
        // Get unique POS values for filter dropdown
        const posSet = new Set(parsedRows.map((row: any) => row.POS));
        setAllPos(Array.from(posSet));
        setLoading(false);
      });
  }, []);

  // Normalize POS values (e.g., RB1 -> RB)
  useEffect(() => {
    if (rows.length > 0) {
      setRows(prevRows => prevRows.map(row => ({
        ...row,
        POS: row.POS.replace(/\d+$/, ''),
      })));
      // Update POS filter options
      const posSet = new Set(rows.map((row: any) => row.POS.replace(/\d+$/, '')));
      setAllPos(Array.from(posSet));
    }
  }, [rows.length]);

  // Filter rows by POS and player name
  const filteredRows = rows.filter((row: any) => {
    const posMatch = posFilter ? row.POS === posFilter : true;
    const nameMatch = playerSearch ? row.Player.toLowerCase().includes(playerSearch.toLowerCase()) : true;
    return posMatch && nameMatch;
  });

  // Handle row click for custom selection
  const handleRowClick = (params: any) => {
    setSelectedRows((prev) => {
      const current = prev[params.id];
      if (!current) return { ...prev, [params.id]: 'red' };
      if (current === 'red') return { ...prev, [params.id]: 'green' };
      if (current === 'green') {
        const { [params.id]: _, ...rest } = prev;
        return rest;
      }
      return prev;
    });
  };

  // Handle cell click for team name editing only
  const handleCellClick = (params: any, event: any) => {
    if (params.field === SELECTED_TEAM_FIELD) {
      event.stopPropagation(); // Prevent row selection
      setTeamEditId(params.row.id);
      setTeamEditValue(selectedTeams[params.row.id] || '');
    }
  };

  // Update selection order on selection change
  useEffect(() => {
    // Only update order for newly selected rows
    const selectedIds = Object.keys(selectedRows).map(Number);
    let nextOrder = Object.values(selectionOrder).length > 0 ? Math.max(...Object.values(selectionOrder)) + 1 : 1;
    let newOrder = { ...selectionOrder };
    selectedIds.forEach((id) => {
      if (!selectionOrder[id]) {
        newOrder[id] = nextOrder++;
      }
    });
    // Remove order for deselected rows
    Object.keys(selectionOrder).forEach((id) => {
      if (!selectedRows[Number(id)]) {
        delete newOrder[Number(id)];
      }
    });
    setSelectionOrder(newOrder);
  }, [selectedRows]);

  // Save selectedRows, selectionOrder, and selectedTeams to file on change
  useEffect(() => {
    fetch('/draftboard-selections.json', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ selectedRows, selectionOrder, selectedTeams }),
    });
  }, [selectedRows, selectionOrder, selectedTeams]);

  // Load selection state from JSON file on mount
  useEffect(() => {
    fetch('/draftboard-selections.json')
      .then((response) => response.json())
      .then((data) => {
        if (data.selectedRows) setSelectedRows(data.selectedRows);
        if (data.selectionOrder) setSelectionOrder(data.selectionOrder);
        if (data.selectedTeams) setSelectedTeams(data.selectedTeams);
      })
      .catch(() => {});
  }, []);

  // Custom row class based on selection state
  const getRowClassName = (params: any) => {
    if (selectedRows[params.id] === 'red') return 'row-red';
    if (selectedRows[params.id] === 'green') return 'row-green';
    return '';
  };

  // Add Selection Order and Selected Team columns
  const columnsWithOrder = [
    ...columns,
    {
      field: SELECTION_ORDER_FIELD,
      headerName: 'Selection Order',
      width: 150,
      renderCell: (params: any) => {
        const id = params.row.id;
        if (orderEditId === id) {
          return (
            <input
              type="number"
              value={orderEditValue}
              style={{ width: '60px' }}
              onChange={e => setOrderEditValue(e.target.value)}
              onBlur={() => {
                setSelectionOrder(prev => ({ ...prev, [id]: Number(orderEditValue) }));
                setOrderEditId(null);
              }}
              autoFocus
            />
          );
        }
        return (
          <span
            style={{ cursor: 'pointer', color: '#1976d2', fontWeight: 500 }}
            onClick={() => {
              setOrderEditId(id);
              setOrderEditValue(selectionOrder[id]?.toString() || '');
            }}
          >
            {selectionOrder[id] || ''}
          </span>
        );
      },
    },
    {
      field: SELECTED_TEAM_FIELD,
      headerName: 'Selected Team',
      width: 180,
      renderCell: (params: any) => {
        const id = params.row.id;
        if (teamEditId === id) {
          return (
            <input
              type="text"
              value={teamEditValue}
              style={{ width: '100px' }}
              onChange={e => setTeamEditValue(e.target.value)}
              onBlur={() => {
                setSelectedTeams(prev => ({ ...prev, [id]: teamEditValue }));
                setTeamEditId(null);
              }}
              autoFocus
            />
          );
        }
        return (
          <span
            style={{ cursor: 'pointer', color: '#388e3c', fontWeight: 500 }}
            onClick={e => {
              e.stopPropagation(); // Prevent row selection
              setTeamEditId(id);
              setTeamEditValue(selectedTeams[id] || '');
            }}
          >
            {selectedTeams[id] || 'Click to enter team'}
          </span>
        );
      },
    },
  ];

  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h4" gutterBottom>
        Draft Board Rankings
      </Typography>
      <FormControl sx={{ mb: 2, minWidth: 200 }}>
        <InputLabel id="pos-filter-label">Filter by Position</InputLabel>
        <Select
          labelId="pos-filter-label"
          value={posFilter}
          label="Filter by Position"
          onChange={(e) => setPosFilter(e.target.value)}
        >
          <MenuItem value="">All Positions</MenuItem>
          {allPos.map((pos) => (
            <MenuItem key={pos} value={pos}>{pos}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl sx={{ mb: 2, minWidth: 200 }}>
        <InputLabel htmlFor="player-search">Search Player</InputLabel>
        <input
          id="player-search"
          type="text"
          value={playerSearch}
          onChange={e => setPlayerSearch(e.target.value)}
          placeholder="Search Player Name"
          style={{ width: '100%', padding: '8px', fontSize: '16px', borderRadius: '4px', border: '1px solid #ccc', marginTop: '8px' }}
        />
      </FormControl>
      <DataGrid
        rows={filteredRows.map(row => ({
          ...row,
          [SELECTION_ORDER_FIELD]: selectionOrder[row.id] || '',
          [SELECTED_TEAM_FIELD]: selectedTeams[row.id] || '',
        }))}
        columns={columnsWithOrder}
        loading={loading}
        autoHeight
        pagination
        initialState={{
          pagination: {
            paginationModel: { pageSize: 25, page: 0 },
          },
        }}
        pageSizeOptions={[25, 50, 100, 200, 500]}
        getRowClassName={getRowClassName}
        onRowClick={handleRowClick}
        onCellClick={handleCellClick}
        sx={{
          background: 'white',
          borderRadius: 2,
          '& .MuiDataGrid-row': {
            color: '#212121',
          },
          '& .row-red': {
            backgroundColor: '#ffebee !important',
            color: '#b71c1c',
          },
          '& .row-green': {
            backgroundColor: '#e8f5e9 !important',
            color: '#1b5e20',
          },
          '& .MuiDataGrid-row:hover': {
            backgroundColor: '#fae0e3ff',
            color: '#1976d2',
          },
        }}
      />
    </Box>
  );
};

export default DraftBoardPage;
