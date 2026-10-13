// Show the image skeleton only while the large login photograph is loading.
const photo = document.querySelector('.login-background');
const skeleton = document.querySelector('[data-image-loading]');
if (photo && skeleton) {
  const ready = () => { skeleton.hidden = true; };
  if (photo.complete) ready();
  else { photo.addEventListener('load', ready, { once: true }); photo.addEventListener('error', ready, { once: true }); }
}
