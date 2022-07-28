import { ICardProps } from '../../dataTypes/ICardProps';
import { CardTable } from '../CardBrowser/CardTable';

export function RosterView(props: {
  dataSet: ICardProps[];
  onRowClick: (e: any) => void;
  onRowDoubleClick: (e: any, index: number) => void;
}) {
  return (
    <>
      <CardTable dataSet={props.dataSet} onRowClick={props.onRowClick} onRowDoubleClick={props.onRowDoubleClick} />
      {/* TODO: remove Type, CP rows from this table (make CardTable columns customizable) */}
    </>
  );
}
