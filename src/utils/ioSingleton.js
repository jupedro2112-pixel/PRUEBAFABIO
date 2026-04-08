let _io = null;

function setIo(io) {
  _io = io;
}

function getIo() {
  return _io;
}

module.exports = { setIo, getIo };
