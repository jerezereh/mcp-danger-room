import MUIDataTable from "mui-datatables";
import data from '../../../assets/CharacterCards.json';

export function CardBrowser() {
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
      {/* <MUIDataTable
        title={"Tactics Cards"}
        data={data.Tactics}
        columns={columns}
        options={options}
      /> */}
      {/* <MUIDataTable
        title={"Objective Cards"}
        data={data.Objectives}
        columns={columns}
        options={options}
      /> */}
    </>);
}