import { useState } from 'react';
import { Table, TableContainer, TableHead, TableBody, TableRow, TableCell, tableCellClasses } from '@mui/material';

export function RosterView() {
  const [value, setValue] = useState('');

  function onSubmit() {}

  return (
    <>
      <TableContainer style={{ paddingRight: '25px' }}>
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
              <TableCell>Cost</TableCell>
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
                <TableCell>{item.alterEgo}</TableCell>
                <TableCell>{item.affiliations.join(', ')}</TableCell>
                <TableCell>{item.cost}</TableCell>
                <TableCell>{item.cp}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <form onSubmit={onSubmit}>
        <label>
          Roster Name:
          <input type="text" value={value} onChange={e => setValue(e.target.value)} />
        </label>
      </form>
      <table>
        <tbody>
          <tr>
            <th>Card Name</th>
            <th>Card Type</th>
          </tr>
          <tr>
            <td>Spider-Man</td>
            <td>Character</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
