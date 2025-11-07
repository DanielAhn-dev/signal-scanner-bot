export const cacheKey = {
  sectorTop: () => `sector:top`,
  stocksBySector: (s:string) => `stocks:${s}`,
  scoreByCode: (c:string) => `score:${c}`,
};
