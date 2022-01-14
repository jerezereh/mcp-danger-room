import MUIDataTable from "mui-datatables";
import data from '../../../assets/CharacterCards.json';

export function RosterView() {
  const columns = ["Name", "Alter Ego", "Affiliations", "Cost", "CP"];
  const options = {
    filter: true,
  };

  return (
    <>
      <MUIDataTable
        title={"Character Cards"}
        data={data.Characters}
        columns={columns}
        options={options}
      />
    </>);
}