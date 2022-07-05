import { useState } from 'react';
import { Table, TableContainer, TableHead, TableBody, TableRow, TableCell, tableCellClasses } from '@mui/material';
import { ICardProps } from '../../dataTypes/ICardProps';

export function RosterView(props: {
  dataSet: ICardProps[];
  onRowClick: (e: any) => void;
  onRowDoubleClick: (e: any, index: number) => void;
}) {
  const [selectedRow, setSelectedRow] = useState<null | number>(null);

  return (
    <>
      <TableContainer
        sx={{
          border: '1px solid',
        }}
      >
        <Table
          sx={{
            [`& .${tableCellClasses.root}`]: {
              // borderBottom: "none"
            },
            backgroundColor: 'white',
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Affiliations</TableCell>
              <TableCell>Cost</TableCell>
              <TableCell>CP</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {props.dataSet.map((item: ICardProps, index: number) => (
              <TableRow
                key={index}
                onClick={e => {
                  props.onRowClick(e);
                  setSelectedRow(index);
                }}
                onDoubleClick={e => {
                  props.onRowDoubleClick(e, index);
                }}
                selected={index === selectedRow}
                sx={{
                  ':hover': {
                    backgroundColor: 'lightblue',
                  },
                  '&.Mui-selected': {
                    backgroundColor: 'aqua',
                  },
                }}
              >
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.type}</TableCell>
                <TableCell>{item.affiliations.join(', ')}</TableCell>
                <TableCell>{item.cost}</TableCell>
                <TableCell>{item.cp}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
