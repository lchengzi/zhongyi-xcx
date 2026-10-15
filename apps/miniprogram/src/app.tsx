import { useEffect, type PropsWithChildren } from 'react';
import { connectivity } from './platform/connectivity';
import './app.scss';

export default function App({ children }: PropsWithChildren) {
  useEffect(() => connectivity.start(), []);
  return children;
}
