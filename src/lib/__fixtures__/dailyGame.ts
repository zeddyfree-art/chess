// A real daily game (players renamed), pasted the way it came out of a chat: the move numbers 15, 28 and 34
// had been turned into 2, 3 and 4 by list formatting. Evaluations: Stockfish 19 at depth 18, White's view.
export const DAILY_PGN = `[Event "Let's Play!"]
[Site "Chess.com"]
[Date "2026-09-08"]
[White "Player"]
[Black "Opponent"]
[Result "0-1"]
[WhiteElo "1299"]
[BlackElo "1267"]
[TimeControl "1/259200"]
[EndDate "2026-10-04"]
[Termination "Opponent won by resignation"]
[Link "https://www.chess.com/game/daily/123456789"]
[ECOUrl "https://www.chess.com/openings/French-Defense-Winawer-Variation-3...Bb4"]

1. d4 e6 2. Nc3 Bb4 3. Bf4 Nf6 4. e3 O-O 5. Bd3 Bxc3+ 6. bxc3 Nd5 7. Ne2 d6 8.
Bg3 a6 9. O-O b5 10. a4 bxa4 11. Rxa4 Nd7 12. c4 N5b6 13. Ra1 Bb7 14. Nc3 Nf6
2. Bh4 Nbd7 16. Ne4 h6 17. Qe2 g5 18. Nxf6+ Nxf6 19. Bg3 Be4 20. f3 Bxd3 21.
Qxd3 Re8 22. f4 Nh7 23. e4 c6 24. fxg5 hxg5 25. Qf3 f6 26. e5 dxe5 27. dxe5 f5
3. Qxc6 Qd4+ 29. Bf2 Qxe5 30. Rxa6 Rac8 31. Qb5 Qc3 32. Rc1 Qxc4 33. Qxc4 Rxc4
4. Rb6 Kf7 35. c3 Nf6 36. Rb4 Rc6 37. c4 Ne4 38. Be1 Rec8 39. Rb7+ Kf6 0-1
`;

/** Per position: 0 = start, i = after move i. */
export const DAILY_EVALS = [
  20, 26, 32, 29, 68, 6, 0, -20, -13, -6, 23, 25, 79, 50, 58, 47, 83, 77, 114, 132, 118, 109, 147, 135, 208, 115, 132, 124, 211, 208, 220,
  153, 151, 124, 168, 115, 121, 112, 168, 95, 96, 82, 105, 93, 497, 181, 383, 392, 424, 174, 177, 37, 37, 45, 67, 7, 149, 160, 175, 185,
  233, 247, 298, 14, 22, -10, -13, -46, -38, -37, -34, -35, -40, -34, -10, -84, -63, -173, -177,
];
