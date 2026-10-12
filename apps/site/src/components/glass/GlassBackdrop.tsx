/**
 * Подложка темы Liquid Glass: размытое фото штаба и медленно плывущие пятна света.
 * Стекло над ней «видит» цвет и движение — без этого прозрачные панели выглядят
 * плоскими. Пятна — радиальные градиенты, двигаются transform'ом (дёшево для GPU).
 */
export function GlassBackdrop() {
  return (
    <div className="g-backdrop" aria-hidden="true">
      <img src="/media/glass-backdrop.webp" alt="" className="g-backdrop-photo" />
      <span className="g-blob g-blob-a" />
      <span className="g-blob g-blob-b" />
      <span className="g-blob g-blob-c" />
      <span className="g-grain" />
    </div>
  )
}
