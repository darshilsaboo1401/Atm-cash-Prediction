import { render, screen } from '@testing-library/react';
import App from './App';

test('renders loading state initially', () => {
  render(<App />);
  const loadingElement = screen.getByText(/Loading ATM network data/i);
  expect(loadingElement).toBeInTheDocument();
});


