// Synthetic credential provenance only; real JWT validation/revocation is tested
// in the disposable native Auth/API gate, not approximated by this fixture.
export function issuedTokens(makeToken) {
  const issued = new Set();
  return {
    issue() {
      const token = makeToken();
      if (typeof token !== 'string' || !token) throw new Error('Synthetic token must be nonempty');
      issued.add(token);
      return token;
    },
    accepts(authorization) {
      const match = typeof authorization === 'string' && /^Bearer ([^\s]+)$/i.exec(authorization);
      return !!match && issued.has(match[1]);
    },
  };
}
