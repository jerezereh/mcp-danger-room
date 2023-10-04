import { Text } from './styles';
import { ISimpleCharacterProps } from '../../dataTypes/ISimpleCharacterProps';

export const CharacterRow = (props: ISimpleCharacterProps) => {
  return (
    <tr key={props.name}>
      <td>
        <Text>{props.name}</Text>
      </td>
      <td>
        <Text>{props.alterEgo}</Text>
      </td>
      <td>
        <Text>{props.affiliations.join(', ')}</Text>
      </td>
      <td>
        <Text>{props.cp}</Text>
      </td>
      <td>
        <Text>{props.cost}</Text>
      </td>
    </tr>
  );
};
