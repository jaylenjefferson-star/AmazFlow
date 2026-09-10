/** @type {import('next').NextConfig} */
const nextConfig = {
  // Every surface keeps the static export (requirement 1.4). There is no frontend server on any of
  // the three origins, which is why design decision D-2 states plainly that a separate origin is
  // defence in depth and the control plane is the authorization boundary.
  output: "export",
  trailingSlash: true,
};

export default nextConfig;
