import styled, { createGlobalStyle } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 16px;
    // color: #E1E1E6;
  }
`;

export const Container = styled.div`
  height: 87vh;
  display: flex;
  flex-direction: column;
  align-items: top;
`;

export const Image = styled.img`
  // min-width: 23vmax;
  // max-width: 23vmax;
  max-height: 20vmax;
  cursor: pointer;
  display: block;
  border: 2px solid;
  margin: 0 25px;
`;

export const Text = styled.p`
  margin-top: 24px;
  font-size: 18px;
`;

export const sidebarStyle = {
  minHeight: '30px',
  maxWidth: '36px',
  padding: '2px 6px 2px 6px',
};
