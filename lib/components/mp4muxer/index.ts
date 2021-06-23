import { MessageType, Message, SdpMessage } from '../message'
import debug from 'debug'
import { Box } from './helpers/isom'
import { BoxBuilder } from './helpers/boxbuilder'
import { Transform } from 'stream'
import { Tube } from '../component'
import { NAL_TYPES } from '../h264depay/parser'
import { messageFromBuffer, sdpMessageClone } from '../../utils/protocols/sdp'

/**
 * Component that converts elementary stream data into MP4 boxes honouring
 * the ISO BMFF Byte Stream (Some extra restrictions are involved).
 */
export class Mp4Muxer extends Tube {
  public boxBuilder: BoxBuilder
  public onSync?: (ntpPresentationTime: number) => void
  /**
   * Create a new mp4muxer component.
   * @return {undefined}
   */
  constructor() {
    const boxBuilder = new BoxBuilder()
    const onSync = (ntpPresentationTime: number) => {
      this.onSync && this.onSync(ntpPresentationTime)
    }
    let sdpHasIncompleteH264Props = false
    let clonedSdpMessage = messageFromBuffer(Buffer.from(''))
    let haveSdpMessage = false
    let cachedSps = Buffer.from('')
    let haveSps = false
    let cachedPps = Buffer.from('')
    let havePps = false
    let sentMoov = false
    const incoming = new Transform({
      objectMode: true,
      transform: function (msg: Message, encoding, callback) {
        if (msg.type === MessageType.SDP) {
          /**
           * Arrival of SDP signals the beginning of a new movie.
           * Set up the ftyp and moov boxes unless sdpHasIncompleteH264Props is true.
           */
          msg.sdp.media.forEach((media) => {
            if (media.rtpmap === undefined) {
              return
            }
            if (media.rtpmap.encodingName === 'H264') {
              sdpHasIncompleteH264Props = true
              if (media.fmtp === undefined) {
                return
              }
              if (typeof media.fmtp.parameters['sprop-parameter-sets'] !== undefined) {
                //console.log("sprops:" + media.fmtp.parameters['sprop-parameter-sets'])
                sdpHasIncompleteH264Props = false
              }
            }
          })
          if (sdpHasIncompleteH264Props) {
            clonedSdpMessage = sdpMessageClone(msg)
            haveSdpMessage = true
          } else {
            this.push(sendFtypMoovFromSdpMessage(msg))
            sentMoov = true
          }
        } else if (
          msg.type === MessageType.ELEMENTARY ||
          msg.type === MessageType.H264
        ) {
          if (msg.type === MessageType.H264 &&
            (msg.nalType === NAL_TYPES.SPS || msg.nalType === NAL_TYPES.PPS)) {
            if (sdpHasIncompleteH264Props && haveSdpMessage && !sentMoov) {
              if (msg.nalType === NAL_TYPES.SPS) {
                haveSps = true
                //Remove 4 byte length field
                cachedSps = Buffer.from(msg.data).subarray(4)
              } else {
                havePps = true
                //Remove 4 byte length field
                cachedPps = Buffer.from(msg.data).subarray(4)
              }
              if (haveSps && havePps) {
                let parameterSets = cachedSps.toString('base64') + ',' + cachedPps.toString('base64')
                clonedSdpMessage.sdp.media.forEach((media) => {
                  if (media.rtpmap === undefined) {
                    return
                  }
                  if (media.rtpmap.encodingName === 'H264') {
                    sdpHasIncompleteH264Props = true
                    if (media.fmtp === undefined) {
                      media.fmtp = {
                        format: '',
                        //Add a default profile-level-id
                        //42h = baseline profile
                        parameters: { 'profile-level-id': '42c028' }
                      }
                    }
                    media.fmtp.parameters['sprop-parameter-sets'] = parameterSets
                    sdpHasIncompleteH264Props = false
                  }
                })
                if (!sdpHasIncompleteH264Props) {
                  //console.log("Creating moov atom from inserted sprop-parameter-sets: " + parameterSets)
                  this.push(sendFtypMoovFromSdpMessage(clonedSdpMessage))
                  sentMoov = true
                }
              }
            }
          } else if (sentMoov) {
            /**
             * Otherwise we are getting some elementary stream data.
             * Set up the moof and mdat boxes.
             */

            const { payloadType, timestamp, ntpTimestamp } = msg
            const trackId = boxBuilder.trackIdMap[payloadType]

            if (trackId) {
              if (!boxBuilder.ntpPresentationTime) {
                boxBuilder.setPresentationTime(trackId, ntpTimestamp)
                if (boxBuilder.ntpPresentationTime) {
                  onSync(boxBuilder.ntpPresentationTime)
                }
              }

              let checkpointTime: number | undefined
              const idrPicture =
                msg.type === MessageType.H264
                  ? msg.nalType === NAL_TYPES.IDR_PICTURE
                  : undefined
              if (
                boxBuilder.ntpPresentationTime &&
                idrPicture &&
                msg.ntpTimestamp !== undefined
              ) {
                checkpointTime =
                  (msg.ntpTimestamp - boxBuilder.ntpPresentationTime) / 1000
              }

              const byteLength = msg.data.byteLength
              const moof = boxBuilder.moof({ trackId, timestamp, byteLength })
              const mdat = boxBuilder.mdat(msg.data)

              const data = Buffer.allocUnsafe(moof.byteLength + mdat.byteLength)
              moof.copy(data, 0)
              mdat.copy(data, moof.byteLength)

              this.push({
                type: MessageType.ISOM,
                data,
                moof,
                mdat,
                ntpTimestamp,
                checkpointTime,
              })
            }
          }
        } else {
          // No message type we recognize, pass it on.
          this.push(msg)
        }
        callback()
      },
    })

    const sendFtypMoovFromSdpMessage = (msg: SdpMessage): any => {
      // Why is this here? These should be default inside the mvhd box?
      const now = Math.floor(new Date().getTime() / 1000 + 2082852000)
      const ftyp = new Box('ftyp')
      const moov = boxBuilder.moov(msg.sdp, now)

      const data = Buffer.allocUnsafe(ftyp.byteLength + moov.byteLength)
      ftyp.copy(data, 0)
      moov.copy(data, ftyp.byteLength)

      debug('msl:mp4:isom')(`ftyp: ${ftyp.format()}`)
      debug('msl:mp4:isom')(`moov: ${moov.format()}`)

      // Set up a list of tracks that contain info about
      // the type of media, encoding, and codec are present.
      const tracks = msg.sdp.media.map((media) => {
        return {
          type: media.type,
          encoding: media.rtpmap && media.rtpmap.encodingName,
          mime: media.mime,
          codec: media.codec,
        }
      })
      return {
        type: MessageType.ISOM,
        data,
        tracks,
        ftyp,
        moov
      }
    }

    super(incoming)
    this.boxBuilder = boxBuilder
  }

  get bitrate() {
    return (
      this.boxBuilder.trackData &&
      this.boxBuilder.trackData.map((data) => data.bitrate)
    )
  }

  get framerate() {
    return (
      this.boxBuilder.trackData &&
      this.boxBuilder.trackData.map((data) => data.framerate)
    )
  }

  get ntpPresentationTime() {
    return this.boxBuilder.ntpPresentationTime
  }
}
