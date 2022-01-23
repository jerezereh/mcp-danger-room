import { DataGrid } from "@mui/x-data-grid";
import { useState } from "react";

export function RosterView(){
    const [value, setValue] = useState('');
    const [rows, setRows] = useState();
    const columns = ['Card Name', 'Card Type'];
    
    function onSubmit(){}
    return (
        <>
        <form onSubmit={onSubmit}>
            <label>
                Roster Name:
                <input type='text' value={value} onChange={e => setValue(e.target.value)} />
            </label>
        </form>
        <table>
            <tr>
                <th>Card Name</th>
                <th>Card Type</th>
            </tr>
            <tr>
                <td>Spider-Man</td>
                <td>Character</td>
            </tr>
        </table>
        </>
    )
}