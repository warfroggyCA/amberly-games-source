import "./brand-wordmark.css";

export function BrandWordmark() {
  return (
    <span className="brand-wordmark" role="img" aria-label="Amberly Games">
      <span className="brand-word" aria-hidden="true">
        <span className="brand-tile">
          A<small>1</small>
        </span>
        <span>mberly</span>
      </span>
      <span className="brand-word" aria-hidden="true">
        <span className="brand-tile">
          G<small>2</small>
        </span>
        <span>ames</span>
      </span>
    </span>
  );
}
