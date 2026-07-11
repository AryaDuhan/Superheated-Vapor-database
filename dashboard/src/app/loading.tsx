export default function Loading() {
  return (
    <div className="page-loading" aria-busy="true" aria-label="Loading">
      <div className="skeleton framed hero-skel" />
      <div className="skeleton-row">
        <div className="skeleton framed skel-stat" />
        <div className="skeleton framed skel-stat" />
        <div className="skeleton framed skel-stat" />
        <div className="skeleton framed skel-stat" />
      </div>
      <div className="skeleton framed panel-skel" />
    </div>
  );
}
