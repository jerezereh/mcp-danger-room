import gsap from 'gsap';
import { useEffect, useRef } from 'react';
import './GameView.scss';

export function GameView() {
  const boxRef = useRef(null);

  useEffect(() => {
    gsap.to(boxRef.current, { rotation: '+=360' });
  });

  return (
    <div className="box" ref={boxRef}>
      Hello
    </div>
  );

  /*
  New Game Button
  Map render, selector?
  
  */
}
