export function statsMediaWidth(cover,petImage,media) {
  return parseFloat(getComputedStyle(cover).width)
    + Number(petImage.getAttribute('width'))
    + parseFloat(getComputedStyle(media).columnGap);
}
