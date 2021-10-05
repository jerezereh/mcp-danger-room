import { GlobalStyle } from './styles/GlobalStyle'
import { CharacterRow } from './components/CharacterRow/CharacterRow'

import data from '../assets/CharacterCards.json'

export function App() {
  return (
    <>
      <GlobalStyle />
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Alter Ego</th>
            <th>Affiliations</th>
            <th>CP</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {data.Characters.map((char) => {
            return (<CharacterRow 
              name={char.Name} 
              alterEgo={char['Alter Ego']} 
              affiliiations={char.Affiliations} 
              cp={char.CP} 
              cost={char.Cost}
              />);
          })}
        </tbody>
      </table>
      {/* <InfoPane></InfoPane> */}
      {/* <RosterView></RosterView> */}
    </>
  )
}