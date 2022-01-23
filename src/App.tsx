import { GlobalStyle } from './styles/GlobalStyle'
import { CardBrowser } from './components/CardBrowser/CardBrowser'
import { InfoPane } from './components/InfoPane/InfoPane'
import { RosterView } from './components/RosterView/RosterView'


export function App() {
  return (
    <>
      <GlobalStyle />
      <CardBrowser />
      <InfoPane/>
      <RosterView />
    </>
  ) 
} 