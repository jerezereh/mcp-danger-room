import { ICharacterCardProps } from '../../dataTypes/ICharacterCardProps';
import { CardTable } from '../CardTable/CardTable';

export function RosterTable(props: {
  dataSet: ICharacterCardProps[];
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
