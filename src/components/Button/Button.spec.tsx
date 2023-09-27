import { render } from '@testing-library/react';
import { Button } from './Button';

test('button should renders', () => {
  const { getByText } = render(<Button>ButtonContent</Button>);

  expect(getByText('ButtonContent')).toBeTruthy();
  expect(getByText('ButtonContent')).toHaveAttribute('type', 'button');
});
