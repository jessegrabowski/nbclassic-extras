# nbclassic-extras

## Bundled extensions

`static/rise/` is the nbextension from the [RISE](https://github.com/damianavila/RISE) 5.7.1 wheel on PyPI, copied byte for byte. RISE is BSD-3-Clause (`licenses/RISE.md`). Its `reveal.js/` directory is [reveal.js](https://github.com/hakimel/reveal.js) 3.9, MIT (`static/rise/reveal.js/LICENSE`). Its `reveal.js-chalkboard/` directory is the chalkboard plugin from [reveal.js-plugins](https://github.com/rajgoel/reveal.js-plugins) 3.9.0, MIT (`licenses/reveal.js-plugins.txt`). RISE's `rise-reveal` npm package (MIT) patched both before they were copied into the wheel.
