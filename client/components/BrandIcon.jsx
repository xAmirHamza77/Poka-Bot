export default function BrandIcon({ className = 'h-10 w-10' }) {
  // The supplied artwork is also used for both native desktop icons.
  return <img src="/poka-logo.jpg" alt="" aria-hidden="true" className={`${className} rounded-[24%] object-cover`} />;
}
