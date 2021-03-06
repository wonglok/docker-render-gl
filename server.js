const Graphics = require('./src/gl-api/ur-graphics.js')

let makeWebServer = () => {
  let express = require('express')
  var app = express()
  var http = require('http').Server(app)
  var io = require('socket.io')(http)
  var port = process.env.PORT || 3123
  var path = require('path')
  console.log(port)

  var cors = function (req, res, next) {
    // Website you wish to allow to connect
    var origin = req.header('origin')
    var host = req.header('host')
    // console.log(req.headers)
    res.setHeader('Access-Control-Allow-Origin', origin || host || '*')
    // if (origins.indexOf(orig + '') !== -1) {

    // } else if (isNotProduction) {
    //   res.setHeader('Access-Control-Allow-Origin', orig || 'https://localhost:12345');
    // }

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE')

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-Widget-Origin, X-XSRF-TOKEN, Origin, X-Token, X-Requested-With, Content-Type, Accept')

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', true)

    res.cookie('SameSite', 'none', {
      secure: true
    })

    // if (req.path)
    // res.setHeader('Content-Type', 'application/json')

    // res.json({ 'ok': true })

    // Pass to next layer of middleware
    next()
  }

  app.use(cors)

  app.use('/preview', express.static('preview'))
  app.use('/resource', express.static('resource'))
  // app.use('/sdk', express.static('build-sdk'))

  app.get('/', function (req, res) {
    res.sendFile(path.join(__dirname, '/src/html/index.html'))
  })

  const webpack = require('webpack')
  // const { CleanWebpackPlugin } = require('clean-webpack-plugin')
  // const Chunks2JsonPlugin = require('chunks-2-json-webpack-plugin')
  const middleware = require('webpack-dev-middleware')
  const compiler = webpack({
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    // webpack options
    entry: './src/gl-api/front-sdk.js',
    output: {
      filename: './sdk/sdk.js',
      path: path.join(__dirname, 'build-sdk')
    }
  })
  app.use(middleware(compiler, {}))
  // setTimeout(() => {
  //   compiler.run()
  // })

  io.on('connection', function (socket) {
    socket.on('chat', function (msg) {
      io.emit('log', { id: Graphics.getID(), html: msg })
    })

    socket.on('make pic', (spec, fn) => {
      createScreenShot({
        spec,
        web: {
          progress: (v) => {
            socket.emit('progress pic', v)
          },
          notify: (msg) => {
            io.emit('log', { id: Graphics.getID(), html: msg })
          },
          done: (data) => {
            console.log(data)
            fn(data)
          }
        }
      })
    })
    socket.on('make video', async (data, fn) => {
      let videoAPI = await makeVideoAPI({
        spec: data,
        web: {
          notify: (msg) => {
            io.emit('log', { id: Graphics.getID(), html: msg })
          },
          progress: (v) => {
            socket.emit('progress video', v)
          },
          done: (data) => {
            fn(data)
          }
        }
      })
      videoAPI.start()
      socket.on('disconnect', () => {
        videoAPI.abort()
      })
    })
  })

  http.listen(port, function () {
    console.log('listening on *:' + port)
  })

  return {
    io
  }
}

let createScreenShot = async ({ spec, web = Graphics.webShim }) => {
  var fs = require('fs')
  var path = require('path')

  web = {
    ...Graphics.webShim,
    ...web
  }
  let pgv = 0.01

  web.progress({
    progress: 0.01
  })

  let intv = setInterval(() => {
    pgv += 0.045
    web.progress({
      progress: pgv
    })
  }, 1)

  let core = await Graphics.generateCore({ web, spec })
  core.scene.rotation.z = Math.PI * 0.5

  // core.scene.rotation.z = Math.PI * 0.5

  var clockNow = 0
  // const SECONDS_OF_VIDEO = core.videoDuration || 1
  const FPS_FIXED = core.fps
  const DELTA = (1000 / FPS_FIXED)
  core.computeTasks({ clock: clockNow, delta: DELTA })
  const { pixels } = core.renderAPI.render()
  // const combined = Buffer.from(pixels)
  let ndarray = require('ndarray')
  let savePixels = require('save-pixels')
  let stream = savePixels(ndarray(pixels, [core.width, core.height, 4]), 'png', { quality: 60 })

  web.streamImage({
    width: core.width,
    height: core.width,
    stream
  })
  clearInterval(intv)

  let newFilename = `_${(Math.random() * 10000000).toFixed(0)}.png`
  let filePath = path.join(__dirname, core.previewFolder, newFilename)
  let writeStream = fs.createWriteStream(filePath)
  stream.pipe(writeStream)
  writeStream.once('close', () => {
    web.progress({
      progress: 1
    })
    web.done({
      url: `${core.spec.site}${core.previewFolder}${newFilename}`,
      filename: `${newFilename}`,
      folder: `${core.spec.site}${core.previewFolder}`,
      site: `${core.spec.site}`
    })
  })

  core.clean()
  core.renderAPI.destory()

  return {
    updateSpec (v) {
      core.spec = v
    }
  }
}

let makeVideoAPI = async ({ spec, web = Graphics.webShim }) => {
  web = {
    ...Graphics.webShim,
    ...web
  }
  let core = await Graphics.generateCore({ web, spec: spec })

  core.scene.rotation.z = Math.PI
  core.scene.scale.x = -1

  const path = require('path')
  const os = require('os')
  const fs = require('fs')
  const Encoder = require('./src/encoder/vid.encoder.js')

  const temp = os.tmpdir()
  const filename = `./_${(Math.random() * 10000000).toFixed(0)}.mp4`
  const onDone = ({ output }) => {
    let newFilename = `_${(Math.random() * 10000000).toFixed(0)}.mp4`
    let newfile = path.join(__dirname, core.previewFolder, newFilename)

    // web.notify(`<a class="link-box" target="_blank" href="${core.spec.site}${core.previewFolder}${newFilename}">${core.spec.site}${core.previewFolder}${newFilename}</a>`)
    // web.notify(`<video autoplay loop controls class="video-box" playsinline src="${core.spec.site}${core.previewFolder}${newFilename}">${newFilename}</video>`)
    web.done({
      url: `${core.spec.site}${core.previewFolder}${newFilename}`,
      filename: `${newFilename}`,
      folder: `${core.spec.site}${core.previewFolder}`,
      site: `${core.spec.site}`
    })
    fs.rename(output, newfile, (err) => {
      if (err) {
        fs.copyFileSync(output, newfile)
        fs.unlinkSync(output)
        console.log('file is at:', newfile)
        // fs.unlinkSync(output)
        // console.log(`https://video-encoder.wonglok.com${core.previewFolder}${newFilename}`)
        core.clean()
        core.renderAPI.destory()
        console.log('cleanup complete!')
      } else {
        console.log('file is at:', newfile)
        // fs.unlinkSync(output)
        // console.log(`https://video-encoder.wonglok.com${core.previewFolder}${newFilename}`)
        core.clean()
        core.renderAPI.destory()
        console.log('cleanup complete!')
      }
      // encoder.kill()
    })
  }

  const encoder = new Encoder({
    output: path.join(temp, filename),
    width: core.width,
    height: core.height,
    fps: core.fps,
    onDone
  })

  // encoder.promise.then(onDone)
  // encoder.on('console', (evt) => {
  //   // console.log(evt)
  // })

  // encoder.on('done', (evt) => {
  //   web.notify('Finished encoding video....')
  // })

  var abort = false
  var i = -1
  var clockNow = 0
  const SECONDS_OF_VIDEO = core.videoDuration || 1
  const FPS_FIXED = core.fps
  const DELTA = (1000 / FPS_FIXED)
  const TOTAL_FRAMES = SECONDS_OF_VIDEO * FPS_FIXED

  const repeat = () => {
    i++
    const now = (i - 1) < 0 ? 0 : (i - 1)
    const progress = {
      at: now.toFixed(0),
      total: TOTAL_FRAMES.toFixed(0),
      percentage: (now / TOTAL_FRAMES).toFixed(4),
      progress: (now / TOTAL_FRAMES).toFixed(6)
    }

    console.log('progress', progress)
    // web.notify(`Motion Graphics Process Progress: ${((now / TOTAL_FRAMES) * 100).toFixed(2).padStart(6, '0')}%, ${now.toFixed(0).padStart(6, '0')} / ${TOTAL_FRAMES.toFixed(0).padStart(6, '0')}`)

    web.progress(progress)

    clockNow += DELTA
    core.computeTasks({ clock: clockNow, delta: DELTA })
    const { pixels } = core.renderAPI.render()
    const combined = Buffer.from(pixels)
    encoder.passThrough.write(combined, () => {
      if (i > TOTAL_FRAMES || abort) {
        web.notify('Finalising video....')
        encoder.passThrough.end()
        // process.nextTick(() => {
        // })
      } else {
        setTimeout(repeat, 0)
      }
    })
  }

  return {
    updateSpec (data) {
      core.spec = data
    },
    start () {
      repeat()
      web.notify('Begin.....')
    },
    abort () {
      core.clean()
      abort = true
    }
  }
}

makeWebServer()
