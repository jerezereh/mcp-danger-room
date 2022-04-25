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
    color: #E1E1E6;
  }
`;

export const Container = styled.div`
  height: 90vh;
  // padding: 25px;
  display: flex;
  flex-direction: column;
  align-items: top;
  // justify-content: center;

  button {
    margin-top: 24px;
  }
`;

export const Image = styled.img`
  width: 400px;
  height: 600px;
  cursor: pointer;
  display: block;
`;

export const Text = styled.p`
  margin-top: 24px;
  font-size: 18px;
`;
