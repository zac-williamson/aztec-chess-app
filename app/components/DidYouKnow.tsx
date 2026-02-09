import React, { useState, useEffect, useRef } from "react";

const FACTS = [
  "This game is being hosted on the public Aztec network \u2014 its revolutionary cryptographic technology allows public blockchain smart contracts to compute on private data.",
  "This game uses MultiParty Computation (MPC) to allow for selective data disclosure \u2014 a powerful new blockchain primitive on Aztec. This game uses it to disclose chess pieces \u2014 but this can be used to securely access counterparty data in complex financial transactions.",
  "All game data is encrypted on the Aztec network, but the smart contract can still validate game logic using private functions \u2014 only on Aztec!",
  "The cryptographic technology that powers Aztec is called CHONK \u2014 it\u2019s so new our engineers named it, not marketing.",
  "The Aztec network is the only blockchain with private programmable composability.",
];

export function DidYouKnow() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * FACTS.length));
  const [fading, setFading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % FACTS.length);
        setFading(false);
      }, 400);
    }, 12000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div className="did-you-know">
      <div className="did-you-know-header">Did you know?</div>
      <p className={`did-you-know-text ${fading ? "fading" : ""}`}>
        {FACTS[index]}
      </p>
    </div>
  );
}
