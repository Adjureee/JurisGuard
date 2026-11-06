export type ImagePoint = [number, number];
export type CameraImageAdjustments = { corners: ImagePoint[]; rotation: number; brightness: number; contrast: number };
export function defaultImageAdjustments(): CameraImageAdjustments {
  return { corners: [[0,0],[1,0],[1,1],[0,1]], rotation: 0, brightness: 100, contrast: 100 };
}
export function validImageCorners(points: ImagePoint[]) {
  if(points.length!==4 || points.some(p=>p.length!==2 || p.some(n=>!Number.isFinite(n)||n<0||n>1))) return false;
  let area=0;
  for(let i=0;i<4;i++) {
    const a=points[i],b=points[(i+1)%4],c=points[(i+2)%4];
    if((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])<=0) return false;
    area+=a[0]*b[1]-b[0]*a[1];
  }
  return area/2>=.02;
}

/** Unit rectangle → original capture quadrilateral; no section/content guessing. */
function projection(points: ImagePoint[]) {
  const [p0,p1,p2,p3]=points;
  const dx1=p1[0]-p2[0],dx2=p3[0]-p2[0],dy1=p1[1]-p2[1],dy2=p3[1]-p2[1];
  const sx=p0[0]-p1[0]+p2[0]-p3[0],sy=p0[1]-p1[1]+p2[1]-p3[1];
  const denominator=dx1*dy2-dx2*dy1;
  const g=Math.abs(sx)+Math.abs(sy)<1e-10?0:(sx*dy2-dx2*sy)/denominator;
  const h=Math.abs(sx)+Math.abs(sy)<1e-10?0:(dx1*sy-sx*dy1)/denominator;
  const a=p1[0]-p0[0]+g*p1[0],b=p3[0]-p0[0]+h*p3[0];
  const d=p1[1]-p0[1]+g*p1[1],e=p3[1]-p0[1]+h*p3[1];
  return (u:number,v:number):ImagePoint=>{const scale=g*u+h*v+1;return [(a*u+b*v+p0[0])/scale,(d*u+e*v+p0[1])/scale];};
}
export function projectivePoint(points: ImagePoint[], u: number, v: number): ImagePoint {return projection(points)(u,v);}

export async function prepareCameraImage(original: File, adjustments: CameraImageAdjustments, maximumDimension=4096, lossless=false): Promise<File> {
  const {corners,rotation,brightness,contrast}=adjustments;
  if(!validImageCorners(corners) || ![0,90,180,270].includes(rotation) || !Number.isFinite(brightness) || !Number.isFinite(contrast) || !Number.isFinite(maximumDimension) || maximumDimension<1 || brightness<50 || brightness>150 || contrast<50 || contrast>150) throw new Error('Check crop corners and adjustment values.');
  const bitmap=await createImageBitmap(original);
  try {
    if(bitmap.width*bitmap.height>24_000_000) throw new Error('This capture is too large to adjust. Use a camera resolution below 24 megapixels.');
    const source=document.createElement('canvas');source.width=bitmap.width;source.height=bitmap.height;
    const ctx=source.getContext('2d',{willReadFrequently:true});if(!ctx) throw new Error('Image processing is unavailable in this browser.');
    ctx.drawImage(bitmap,0,0);
    const pixels=ctx.getImageData(0,0,source.width,source.height);
    const distance=(a:ImagePoint,b:ImagePoint)=>Math.hypot((a[0]-b[0])*source.width,(a[1]-b[1])*source.height);
    const naturalWidth=Math.max(distance(corners[0],corners[1]),distance(corners[3],corners[2]));
    const naturalHeight=Math.max(distance(corners[0],corners[3]),distance(corners[1],corners[2]));
    const scale=Math.min(1,maximumDimension/Math.max(naturalWidth,naturalHeight));
    const width=Math.max(1,Math.round(naturalWidth*scale)),height=Math.max(1,Math.round(naturalHeight*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const output=canvas.getContext('2d');if(!output) throw new Error('Could not prepare the image.');
    const image=output.createImageData(width,height);
    const project=projection(corners);
    const read=(px:number,py:number,channel:number)=>pixels.data[(py*source.width+px)*4+channel];
    // Bilinear sampling preserves faint handwriting and small checkbox marks.
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const [nx,ny]=project((x+.5)/width,(y+.5)/height);
      const sx=Math.max(0,Math.min(source.width-1,nx*source.width-.5));
      const sy=Math.max(0,Math.min(source.height-1,ny*source.height-.5));
      const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(source.width-1,x0+1),y1=Math.min(source.height-1,y0+1);
      const fx=sx-x0,fy=sy-y0,index=(y*width+x)*4;
      for(let channel=0;channel<3;channel++) {
        const value=(read(x0,y0,channel)*(1-fx)+read(x1,y0,channel)*fx)*(1-fy)+(read(x0,y1,channel)*(1-fx)+read(x1,y1,channel)*fx)*fy;
        image.data[index+channel]=((value-128)*contrast/100+128)*brightness/100;
      }
      image.data[index+3]=255;
    }
    output.putImageData(image,0,0);
    const rotated=document.createElement('canvas');
    rotated.width=rotation%180?height:width;rotated.height=rotation%180?width:height;
    const final=rotated.getContext('2d');if(!final) throw new Error('Could not rotate the image.');
    final.translate(rotated.width/2,rotated.height/2);final.rotate(rotation*Math.PI/180);final.drawImage(canvas,-width/2,-height/2);
    const mime=lossless?'image/png':'image/jpeg';
    const blob=await new Promise<Blob>((resolve,reject)=>rotated.toBlob(b=>b?resolve(b):reject(new Error('Could not encode the selected image.')),mime,.98));
    if(blob.size>25*1024*1024) throw new Error('The adjusted image exceeds 25 MB. Reduce the camera resolution and retake.');
    return new File([blob],original.name.replace(/\.[^.]+$/,'')+(lossless?'-crop.png':'-adjusted.jpg'),{type:mime});
  } finally {bitmap.close();}
}
