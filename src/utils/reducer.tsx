import { useCallback, useReducer, useRef } from 'react';

export const useEnhancedReducer = (
  reducer: Parameters<typeof useReducer>[0],
  initState: Parameters<typeof useReducer>[1]
) => {
  const lastState = useRef<ReturnType<typeof reducer>>(initState);
  const getState = useCallback(() => lastState.current, []);
  return [
    ...useReducer(
      // eslint-disable-next-line no-return-assign
      (state: Parameters<typeof reducer>[0], action: Parameters<typeof reducer>[1]) =>
        (lastState.current = reducer(state, action)),
      initState
    ),
    getState,
  ];
};
