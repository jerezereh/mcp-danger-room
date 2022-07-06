import TableCell, { TableCellProps } from '@mui/material/TableCell';
import { styled } from '@mui/material/styles';

interface StyledTableCellProps extends TableCellProps {
  contrast?: boolean;
}

export default styled(TableCell, {
  shouldForwardProp: prop => prop !== 'contrast',
})<StyledTableCellProps>(({ contrast, theme }) => ({
  ...(contrast && {
    backgroundColor: theme.palette.primary.light,
  }),
  padding: '0px 6px 0px 6px',
}));
