/** Returns false if request was rejected with 401 (missing/invalid token). */
export function tokenOk(req, res, token) {
  if (token && req.headers['x-dashboard-token'] !== token) {
    res.writeHead(401);
    res.end('Unauthorized');
    return false;
  }
  return true;
}
