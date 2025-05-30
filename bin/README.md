# Heroku Buildpack interface

These executables `bin/detect`, `bin/compile`, & `bin/release` implement the [Heroku Buildpack API](https://devcenter.heroku.com/articles/buildpack-api), so that this repo can be used as a buildpack to install this auth proxy inside of another Heroku app, running as a single process tree.
