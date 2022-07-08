import { useState } from 'react';
import { Table, TableContainer, TableHead, TableBody, TableRow, tableCellClasses } from '@mui/material';
import { ICardProps } from '../../dataTypes/ICardProps';
import StyledTableCell from '../StyledComponents/StyledTableCell';

export function CardTable(props: {
  dataSet: ICardProps[];
  onRowClick: (e: any) => void;
  onRowDoubleClick: (e: any) => void;
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
            [`& .${tableCellClasses.root}`]: {},

            backgroundColor: 'white',
          }}
        >
          <TableHead>
            <TableRow>
              <StyledTableCell contrast={true}>Name</StyledTableCell>
              <StyledTableCell contrast={true}>Alter Ego</StyledTableCell>
              <StyledTableCell contrast={true}>Type</StyledTableCell>
              <StyledTableCell contrast={true}>Affiliations</StyledTableCell>
              <StyledTableCell contrast={true}>Cost</StyledTableCell>
              <StyledTableCell contrast={true}>CP</StyledTableCell>
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
                  props.onRowDoubleClick(e);
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
                <StyledTableCell>{item.name}</StyledTableCell>
                <StyledTableCell>{item.alterEgo}</StyledTableCell>
                <StyledTableCell>{item.type}</StyledTableCell>
                <StyledTableCell>{item.affiliations.join(', ')}</StyledTableCell>
                <StyledTableCell>{item.cost}</StyledTableCell>
                <StyledTableCell>{item.cp}</StyledTableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
