import React from "react";
import { Table, TableContainer, TableHead, TableBody, TableRow, TableCell, tableCellClasses } from "@mui/material";
import { ICardProps } from "../../dataTypes/ICardProps";

export function CardTable(props: { dataSet: ICardProps[], onRowClick: (e: any) => void }) {
  const [selectedRow, setSelectedRow] = React.useState<null | number>(null);

  return (
    <>
      <TableContainer>
        <Table
          sx={{
            [`& .${tableCellClasses.root}`]: {
              // borderBottom: "none"
            },
            backgroundColor: "white"
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Alter Ego</TableCell>
              <TableCell>Affiliations</TableCell>
              <TableCell>Cost</TableCell>
              <TableCell>CP</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {props.dataSet.map((item: ICardProps, index: number) => (
              <TableRow
                key={index}
                onClick={(e) => { props.onRowClick(e); setSelectedRow(index); console.log(selectedRow, e); }}
                selected={index === selectedRow}
                sx={{
                  ":hover": {
                    backgroundColor: "lightblue"
                  },
                  "&.Mui-selected": {
                    backgroundColor: "aqua"
                  }
                }}
              >
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.alterEgo}</TableCell>
                <TableCell>{item.affiliations.join(", ")}</TableCell>
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