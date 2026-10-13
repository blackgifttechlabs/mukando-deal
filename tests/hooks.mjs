// Test-only module hooks: run the browser modules in Node against the local database emulator.
// CDN imports map to the npm "firebase" package, and js/firebase.js is replaced by a stub.
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('https://www.gstatic.com/firebasejs/')) {
    const name = specifier.split('/').pop().replace('.js', '').replace('firebase-', '');
    return next('firebase/' + name, { ...context, parentURL: import.meta.url });
  }
  if (specifier === './firebase.js' && context.parentURL?.includes('/js/')) {
    // The "?u=" query decides which signed-in user the database connection pretends to be.
    const query = new URL(context.parentURL).search;
    return { url: new URL('./firebase-stub.mjs', import.meta.url).href + query, shortCircuit: true };
  }
  return next(specifier, context);
}
